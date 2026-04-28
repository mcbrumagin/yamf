/**
 * Process Manager 3 - a lightweight pm2-inspired process manager designed for yamf CLI
 *
 * State is persisted to $YAMF_HOME/pm3/state.json (defaults to $PWD/.yamf/pm3/state.json).
 * Processes are tracked by PID, validated for liveness on read.
 */

import { httpRequest, HEADERS, COMMANDS, Logger, envConfig } from '@yamf/core'
import { writeFileSync, readFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { join, resolve as pathResolve, basename } from 'node:path'
import { spawnDetached } from './spawn.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const logger = new Logger()

/**
 * How long to wait after SIGTERM for the child to exit before SIGKILL.
 * Must cover `@yamf/core` `process-lifecycle`: each `registerTerminable` may run up to
 * `YAMF_GRACEFUL_SHUTDOWN_MS` (registry unregister + `server.close()`). The old fixed
 * 20×250ms = 5s window routinely expired first, so PM3 sent SIGKILL while SIGTERM
 * shutdown was still in progress.
 *
 * Set `YAMF_PM3_STOP_GRACE_MS` to override (total milliseconds after SIGTERM).
 */
function getStopGraceAfterSigtermMs () {
  const explicit = envConfig.get('YAMF_PM3_STOP_GRACE_MS')
  if (explicit != null && explicit !== '') {
    const n = Number(explicit)
    if (Number.isFinite(n) && n >= 0) return n
  }
  const retries = Number(envConfig.get('YAMF_PM3_SIGTERM_RETRIES', 20))
  const waitMs = Number(envConfig.get('YAMF_PM3_SIGTERM_MS', 250))
  const legacyTotal = retries * waitMs
  const graceful = Number(envConfig.get('YAMF_GRACEFUL_SHUTDOWN_MS', 15000))
  return Math.max(legacyTotal, graceful + 2000)
}

function getYamfHome() {
  const home = process.env.YAMF_HOME || join(process.cwd(), '.yamf')
  const pm3Dir = join(home, 'pm3')
  mkdirSync(pm3Dir, { recursive: true })
  return home
}

function getStatePath() {
  return join(getYamfHome(), 'pm3', 'state.json')
}

function getLogDir() {
  const logDir = join(getYamfHome(), 'pm3', 'logs')
  mkdirSync(logDir, { recursive: true })
  return logDir
}

function getLogFile(filepath, suffix) {
  const name = basename(filepath, '.js')
  const tag = suffix != null ? `-${suffix}` : ''
  return join(getLogDir(), `${name}${tag}.log`)
}

function loadState() {
  const statePath = getStatePath()
  if (!existsSync(statePath)) {
    return { processes: {}, registryUrl: null, startedAt: null }
  }
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return { processes: {}, registryUrl: null, startedAt: null }
  }
}

function saveState(state) {
  const statePath = getStatePath()
  const tmpPath = statePath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(state, null, 2))
  renameSync(tmpPath, statePath)
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function getServiceStateSnapshot(registryUrl) {
  const result = await httpRequest(registryUrl, {
    headers: {
      [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL
    }
  })
  return result.services || {}
}

function detectNewServices(before, after) {
  const diff = {}
  for (const serviceName in after) {
    if (!before[serviceName]) {
      diff[serviceName] = after[serviceName]
    } else {
      const newLocations = after[serviceName].filter(loc => !before[serviceName].includes(loc))
      if (newLocations.length) diff[serviceName] = newLocations
    }
  }
  return diff
}

function looksLikeFilepath(target) {
  return target.includes('/') || target.includes('\\') || target.endsWith('.js')
}

function resolveStateKey(state, filepath) {
  const resolved = pathResolve(filepath)
  if (state.processes[resolved]) return resolved
  if (state.processes[`${resolved}#0`]) return `${resolved}#0`
  const keys = Object.keys(state.processes).filter(k => k === resolved || k.startsWith(resolved + '#'))
  return keys.length > 0 ? keys[0] : resolved
}

function resolveAllStateKeys(state, filepath) {
  const resolved = pathResolve(filepath)
  return Object.keys(state.processes).filter(k => k === resolved || k.startsWith(resolved + '#'))
}

function resolveByServiceName(state, name) {
  const keys = []
  for (const key in state.processes) {
    const entry = state.processes[key]
    if (entry.services && name in entry.services) {
      keys.push(key)
    }
  }
  return keys
}

/** Stopped / dead PM3 rows still have `services` filled — do not use them for stop/restart/rolling. */
function filterActiveProcessKeys(state, keys) {
  return keys.filter((k) => {
    const e = state.processes[k]
    return !!(e && e.pid && isProcessAlive(e.pid))
  })
}

/**
 * Unified target resolution: service name, filepath, or filepath#N / service-name#N.
 * Returns { keys: string[], isServiceName: boolean }
 */
function resolveTarget(state, target) {
  const hashIdx = target.indexOf('#')
  const instanceNum = hashIdx !== -1 ? target.slice(hashIdx + 1) : null
  const base = hashIdx !== -1 ? target.slice(0, hashIdx) : target

  if (looksLikeFilepath(base)) {
    if (instanceNum !== null) {
      const resolved = pathResolve(base)
      const key = `${resolved}#${instanceNum}`
      return { keys: state.processes[key] ? [key] : [], isServiceName: false }
    }
    return { keys: resolveAllStateKeys(state, base), isServiceName: false }
  }

  // Try service-name resolution
  const serviceKeys = resolveByServiceName(state, base)
  if (serviceKeys.length > 0) {
    if (instanceNum !== null) {
      const filtered = serviceKeys.filter(k => k.endsWith(`#${instanceNum}`))
      return { keys: filtered, isServiceName: true }
    }
    return { keys: serviceKeys, isServiceName: true }
  }

  // Fallback to filepath resolution (handles bare filenames without extension)
  if (instanceNum !== null) {
    const resolved = pathResolve(base)
    const key = `${resolved}#${instanceNum}`
    return { keys: state.processes[key] ? [key] : [], isServiceName: false }
  }
  return { keys: resolveAllStateKeys(state, base), isServiceName: false }
}

export class PM3 {
  constructor() {
    this.registryRunning = null
  }

  get registryUrl() {
    return process.env.YAMF_REGISTRY_URL
  }

  async checkRegistryRunning() {
    const maxAttempts = Math.max(2, Number(envConfig.get('YAMF_PM3_REGISTRY_CHECK_ATTEMPTS', 10)))
    const intervalMs = Math.max(20, Number(envConfig.get('YAMF_PM3_REGISTRY_CHECK_MS', 100)))
    let attempts = 0
    while (++attempts < maxAttempts) {
      await sleep(intervalMs)
      if (!this.registryUrl) {
        this.registryRunning = false
        return false
      }
      try {
        await httpRequest(this.registryUrl, {
          headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL }
        })
        this.registryRunning = true
      } catch (err) {
        if (err.message && err.message.includes('Fetch failed')) this.registryRunning = false
        else if (err.httpStatus) this.registryRunning = true
        else this.registryRunning = false
      }
    }
    return this.registryRunning
  }

  pruneDeadProcesses() {
    const state = loadState()
    let changed = false
    for (const filepath in state.processes) {
      const entry = state.processes[filepath]
      if (entry.pid && !isProcessAlive(entry.pid)) {
        entry.status = 'stopped'
        entry.pid = null
        changed = true
      }
    }
    if (changed) saveState(state)
    return state
  }

  resolve(target) {
    const state = loadState()
    return resolveTarget(state, target)
  }

  /**
   * When a second instance of the same filepath is started, rename the bare
   * key to #0 so all instances are consistently numbered.
   */
  normalizeToZero(state, resolvedPath) {
    if (!state.processes[resolvedPath]) return
    if (state.processes[`${resolvedPath}#0`]) return

    const entry = state.processes[resolvedPath]
    const newKey = `${resolvedPath}#0`
    const newLogFile = getLogFile(resolvedPath, '0')

    // Rename the log file on disk if it exists
    if (entry.logFile && existsSync(entry.logFile) && entry.logFile !== newLogFile) {
      try { renameSync(entry.logFile, newLogFile) } catch { /* best effort */ }
    }

    state.processes[newKey] = { ...entry, logFile: newLogFile }
    delete state.processes[resolvedPath]
    saveState(state)
  }

  async start(filepath, { internal = false, env } = {}) {
    if (!filepath) throw new Error('filepath is required')
    const resolvedPath = pathResolve(filepath)

    const state = loadState()
    let stateKey = resolvedPath

    // Check if the bare key already has a running process
    const bareEntry = state.processes[resolvedPath]
    const zeroEntry = state.processes[`${resolvedPath}#0`]

    if (bareEntry?.pid && isProcessAlive(bareEntry.pid)) {
      // First additional instance — normalize the bare key to #0
      this.normalizeToZero(state, resolvedPath)

      // Now find next available instance number
      let i = 1
      while (state.processes[`${resolvedPath}#${i}`]?.pid
        && isProcessAlive(state.processes[`${resolvedPath}#${i}`].pid)) {
        i++
      }
      stateKey = `${resolvedPath}#${i}`
    } else if (zeroEntry?.pid && isProcessAlive(zeroEntry.pid)) {
      // Already normalized — find next available instance number
      let i = 1
      while (state.processes[`${resolvedPath}#${i}`]?.pid
        && isProcessAlive(state.processes[`${resolvedPath}#${i}`].pid)) {
        i++
      }
      stateKey = `${resolvedPath}#${i}`
    }

    const suffix = stateKey.includes('#') ? stateKey.split('#').pop() : null
    const logFile = getLogFile(resolvedPath, suffix)

    const registryWasRunning = await this.checkRegistryRunning()

    let beforeSnapshot = {}
    if (this.registryRunning) {
      beforeSnapshot = await getServiceStateSnapshot(this.registryUrl)
    }

    const { pid } = await spawnDetached('node', [resolvedPath], {
      waitFor: 'running',
      timeout: 5000,
      logFile,
      env
    })

    logger.info(`Started process ${resolvedPath} (PID: ${pid})`)
    logger.info(`Logs: ${logFile}`)

    state.processes[stateKey] = {
      pid,
      filepath: resolvedPath,
      logFile,
      services: {},
      startedAt: new Date().toISOString(),
      restarts: state.processes[stateKey]?.restarts || 0,
      internal,
      status: 'running'
    }
    if (this.registryUrl) state.registryUrl = this.registryUrl
    if (!state.startedAt) state.startedAt = new Date().toISOString()
    saveState(state)

    if (!this.registryRunning) {
      const nowRunning = await this.checkRegistryRunning()
      if (!registryWasRunning && nowRunning) {
        const updated = loadState()
        if (updated.processes[stateKey]) {
          updated.processes[stateKey].services.registry = [this.registryUrl]
          updated.processes[stateKey].isRegistry = true
          saveState(updated)
          logger.info(`Registry tracked @ ${this.registryUrl}`)
        }
      }
    }

    if (this.registryRunning) {
      const services = await this.pollUntilNoNewServices(beforeSnapshot)
      if (Object.keys(services).length > 0) {
        const updated = loadState()
        if (updated.processes[stateKey]) {
          Object.assign(updated.processes[stateKey].services, services)
          saveState(updated)
        }
      }
    }

    return loadState().processes[stateKey]
  }

  pollDefaults() {
    return {
      maxAttempts: Number(envConfig.get('YAMF_PM3_POLL_MAX_ATTEMPTS', 150)),
      intervalMs: Number(envConfig.get('YAMF_PM3_POLL_INTERVAL_MS', 200)),
      consecutiveChecksRequired: Number(envConfig.get('YAMF_PM3_POLL_STABLE_CHECKS', 3))
    }
  }

  async pollUntilNoNewServices(beforeSnapshot, overrides = {}) {
    const {
      maxAttempts,
      intervalMs,
      consecutiveChecksRequired
    } = { ...this.pollDefaults(), ...overrides }
    let lastN = -1
    let consecutiveChecks = 0
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) await sleep(intervalMs)
      try {
        const afterSnapshot = await getServiceStateSnapshot(this.registryUrl)
        const services = detectNewServices(beforeSnapshot, afterSnapshot)
        const n = Object.keys(services).length
        if (n === lastN) consecutiveChecks++
        else {
          consecutiveChecks = 0
        }
        lastN = n
        if (n > 0 && consecutiveChecks >= consecutiveChecksRequired) return services
      } catch {
        // registry may have just started, or the process is still booting
      }
    }
    logger.warn('No new services detected after polling — process may not register any services')
    return {}
  }

  /**
   * How often to poll the PID after SIGTERM (ms). Finer than `YAMF_PM3_SIGTERM_MS` legacy meaning;
   * does not change total max wait (`getStopGraceAfterSigtermMs()`).
   */
  getStopSigtermPollMs () {
    const p = envConfig.get('YAMF_PM3_STOP_POLL_MS', null)
    if (p != null && p !== '') {
      const n = Number(p)
      if (Number.isFinite(n) && n >= 10) return Math.min(500, n)
    }
    return 100
  }

  /** @returns {false} to skip; env `YAMF_PM3_STOP_REGISTRY_BROADCAST=0` disables. */
  shouldUseRegistryBroadcastStop () {
    return envConfig.get('YAMF_PM3_STOP_REGISTRY_BROADCAST', '1') !== '0'
  }

  /**
   * Ask a reachable registry to fan out {@link COMMANDS#REGISTRY_BROADCAST_SHUTDOWN} (HTTP
   * SERVICE_SHUTDOWN to all registered non-pure services). No-op if no URL. Used by `stop --all`
   * and by `stop` when the target includes a registry process (same idea as `restart` + registry).
   */
  async tryRegistryBroadcastShutdown (reason = 'yamf-stop') {
    const st = loadState()
    const registryUrl = process.env.YAMF_REGISTRY_URL || st.registryUrl
    if (!registryUrl) {
      return false
    }
    const headers = {
      [HEADERS.COMMAND]: COMMANDS.REGISTRY_BROADCAST_SHUTDOWN,
      [HEADERS.SHUTDOWN_REASON]: String(reason)
    }
    if (process.env.YAMF_REGISTRY_TOKEN) {
      headers[HEADERS.REGISTRY_TOKEN] = process.env.YAMF_REGISTRY_TOKEN
    }
    try {
      await httpRequest(registryUrl, { headers })
      logger.info(`Registry accepted broadcast shutdown (${reason})`)
      return true
    } catch (e) {
      logger.warn(`Registry broadcast shutdown skipped or failed: ${e.message || e}`)
      return false
    }
  }

  /**
   * When stopping by name or filepath, warn if a registered service on that process is **pure**
   * (in-process) — `SERVICE_SHUTDOWN` is not used for pure; only stopping the host PM3 process applies.
   * @param {string} target
   * @returns {Promise<string[]>} lines to show with logger.warn
   */
  async getPureServiceStopWarnings (target) {
    const state = this.pruneDeadProcesses()
    const { keys: rawKeys } = resolveTarget(state, target)
    const keys = filterActiveProcessKeys(state, rawKeys)
    if (keys.length === 0) {
      return []
    }
    const registryUrl = process.env.YAMF_REGISTRY_URL || state.registryUrl
    if (!registryUrl) {
      return []
    }
    let pull
    try {
      pull = await httpRequest(registryUrl, { headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL } })
    } catch {
      return []
    }
    const access = pull?.serviceAccess && typeof pull.serviceAccess === 'object' ? pull.serviceAccess : {}
    const lines = new Set()
    for (const key of keys) {
      const entry = state.processes[key]
      if (!entry?.services || typeof entry.services !== 'object') {
        continue
      }
      for (const svc of Object.keys(entry.services)) {
        if (access[svc] === 'pure') {
          lines.add(
            `Service "${svc}" is registered with access "pure" (in-process, no HTTP). ` +
              `Stopping ${entry.filepath} terminates the whole host process; yamf does not send a separate SERVICE_SHUTDOWN to pure. ` +
              'To stop a co-hosted bundle explicitly, use: yamf stop <path-to-host>.'
          )
        }
      }
    }
    return [...lines]
  }

  /**
   * `yamf stop` when the resolution includes a registry-tagged process: like restart-with-registry,
   * ask the registry to broadcast first, then PM3-signal remaining PIDs.
   */
  async stopWithRegistryBroadcast (state, keys) {
    if (this.shouldUseRegistryBroadcastStop()) {
      const ok = await this.tryRegistryBroadcastShutdown('yamf-stop')
      if (ok) {
        const settle = Number(envConfig.get('YAMF_PM3_BROADCAST_SETTLE_MS', 1500))
        await sleep(settle)
      }
    }
    let st = this.pruneDeadProcesses()
    const ordered = [...keys].sort((a, b) => {
      const ar = st.processes[a]?.isRegistry ? 1 : 0
      const br = st.processes[b]?.isRegistry ? 1 : 0
      return ar - br
    })
    const results = []
    for (const key of ordered) {
      st = this.pruneDeadProcesses()
      if (st.processes[key]?.pid && isProcessAlive(st.processes[key].pid)) {
        results.push(await this.stopOneFromState(st, key))
      }
    }
    return results.length === 1 ? results[0] : results
  }

  /**
   * Stop one process; `state` must be current (e.g. from `pruneDeadProcesses` or a prior pass).
   * Mutates and persists `state`.
   */
  async stopOneFromState (state, stateKey) {
    const entry = state.processes[stateKey]
    if (!entry) throw new Error(`No managed process found for ${stateKey}`)

    if (!entry.pid || entry.status === 'stopped') {
      logger.info(`Process ${entry.filepath} is already stopped`)
      return entry
    }

    const pid = entry.pid

    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      logger.warn(`Process ${pid} already dead`)
    }

    const maxWaitMs = getStopGraceAfterSigtermMs()
    const termSleep = this.getStopSigtermPollMs()
    const termGrace = Math.max(1, Math.ceil(maxWaitMs / termSleep))
    let dead = false
    for (let i = 0; i < termGrace; i++) {
      await sleep(termSleep)
      if (!isProcessAlive(pid)) { dead = true; break }
    }

    if (!dead) {
      logger.warn(`Process ${pid} did not exit after SIGTERM, sending SIGKILL`)
      try { process.kill(pid, 'SIGKILL') } catch { /* already dead */ }
      await sleep(100)
    }

    entry.pid = null
    entry.status = 'stopped'
    saveState(state)

    logger.info(`Stopped ${entry.filepath} (PID: ${pid})`)
    return entry
  }

  async stopOne (stateKey) {
    const state = this.pruneDeadProcesses()
    return this.stopOneFromState(state, stateKey)
  }

  async stop(target) {
    if (!target) throw new Error('target is required')

    const state = this.pruneDeadProcesses()
    const { keys: rawKeys } = resolveTarget(state, target)
    const keys = filterActiveProcessKeys(state, rawKeys)

    if (keys.length === 0) {
      throw new Error(
        rawKeys.length
          ? `No running process for "${target}" (${rawKeys.length} stopped/orphan key(s) in state — use yamf delete <target> to clear)`
          : `No managed process found for "${target}"`
      )
    }

    if (keys.some((k) => state.processes[k]?.isRegistry)) {
      return this.stopWithRegistryBroadcast(state, keys)
    }

    const results = []
    for (const key of keys) {
      results.push(await this.stopOneFromState(state, key))
    }
    return results.length === 1 ? results[0] : results
  }

  async restart(target, options) {
    this.pruneDeadProcesses()
    const state = loadState()
    const { keys: rawKeys } = resolveTarget(state, target)
    const keys = filterActiveProcessKeys(state, rawKeys)

    if (keys.length === 0) {
      throw new Error(
        rawKeys.length
          ? `No running process for "${target}" (${rawKeys.length} stopped/orphan key(s) in state — use yamf delete <target> to clear)`
          : `No managed process found for "${target}"`
      )
    }

    if (keys.some(k => state.processes[k]?.isRegistry)) {
      return this.restartWithRegistry(state, keys, options)
    }

    const results = []
    for (const key of keys) {
      const stateNow = loadState()
      const entry = stateNow.processes[key]
      if (!entry) {
        throw new Error(`PM3 state key "${key}" missing during restart`)
      }
      const wasInternal = entry?.internal || false
      await this.stopOne(key)
      await sleep(200)
      const result = await this.start(entry.filepath, { internal: wasInternal, ...options })

      const updated = loadState()
      const newKey = resolveStateKey(updated, entry.filepath)
      if (updated.processes[newKey]) {
        updated.processes[newKey].restarts = (entry?.restarts || 0) + 1
        saveState(updated)
      }
      results.push(result)
    }

    return results.length === 1 ? results[0] : results
  }

  /**
   * Rolling restart: for each resolved instance, spawn a replacement first, wait for it to
   * register with the registry, then SIGTERM the old instance. Yields zero-downtime behavior
   * for load-balanced services.
   *
   * Constraints:
   * - Registry targets are refused locally (port collision — rolling registry needs k3s).
   * - Pure services (no HTTP, no registry lookup) fall back to the standard restart path.
   */
  async restartRolling(target, options = {}) {
    this.pruneDeadProcesses()
    const state0 = loadState()
    const { keys: rawKeys } = resolveTarget(state0, target)
    const keys = filterActiveProcessKeys(state0, rawKeys)

    if (keys.length === 0) {
      throw new Error(
        rawKeys.length
          ? `No running process for "${target}" (${rawKeys.length} stopped/orphan key(s) in state — use yamf delete <target> to clear)`
          : `No managed process found for "${target}"`
      )
    }

    if (keys.some(k => state0.processes[k]?.isRegistry)) {
      throw new Error(
        'Rolling restart of the registry is not supported locally (port collision). ' +
        'Registry rolling is driven by k3s readiness + REGISTRY_DRAIN — see yamf/docs/ROADMAP.md.'
      )
    }

    const resolveBundleSpawnPath = (entry) => {
      const raw = options?.bundlePath || (options?.env && options.env.YAMF_BUNDLE_PATH)
      if (raw) {
        const abs = pathResolve(raw)
        if (existsSync(abs)) {
          return abs
        }
        logger.warn(`Bundle path not found, using existing filepath: ${abs}`)
      }
      return entry.filepath
    }

    const results = []
    const replaced = []
    for (const key of keys) {
      const state = loadState()
      const entry = state.processes[key]
      if (!entry || !entry.pid || !isProcessAlive(entry.pid)) {
        logger.warn(`Rolling restart: skip "${key}" (process not running; stale state?)`)
        continue
      }
      const wasInternal = entry?.internal || false
      const oldPid = entry.pid
      const oldKey = key

      const spawnPath = resolveBundleSpawnPath(entry)
      logger.info(`Rolling restart: spawning replacement for ${spawnPath} (PID ${oldPid || '-'})`)
      const { bundlePath, ...startOpts } = options || {}
      const fresh = await this.start(spawnPath, { internal: wasInternal, ...startOpts })

      // After start(), the old entry may have been renormalized (bare key → #0).
      // Re-resolve the old instance by PID so we stop the right one.
      const afterStart = loadState()
      const stopKey = Object.keys(afterStart.processes)
        .find(k => afterStart.processes[k]?.pid === oldPid) || oldKey

      try {
        const st = this.pruneDeadProcesses()
        await this.stopOneFromState(st, stopKey)
      } catch (err) {
        logger.warn(`Rolling restart: failed to stop old instance ${stopKey}: ${err.message}`)
      }

      const updated = loadState()
      const newKey = resolveStateKey(updated, spawnPath)
      if (updated.processes[newKey]) {
        updated.processes[newKey].restarts = (entry?.restarts || 0) + 1
        saveState(updated)
      }
      results.push(fresh)
      replaced.push({ oldKey: stopKey, newKey })
    }

    logger.info(`Rolling restart complete: ${replaced.length} instance(s) replaced`)
    return { replaced, results }
  }

  async restartWithRegistry(state, registryKeys, options) {
    logger.warn('Registry restart detected — all services must be restarted to replenish registry state')

    const registryEntry = state.processes[registryKeys[0]]
    if (!registryEntry) {
      throw new Error('Registry process entry not found in state')
    }

    const dependentEntries = []
    for (const key of Object.keys(state.processes)) {
      if (registryKeys.includes(key)) continue
      const entry = state.processes[key]
      if (entry) dependentEntries.push({ key, ...entry })
    }

    for (const dep of dependentEntries) {
      if (dep.pid && isProcessAlive(dep.pid)) {
        try { await this.stopOne(dep.key) } catch { /* best effort */ }
      }
    }
    for (const key of registryKeys) {
      const entry = state.processes[key]
      if (entry?.pid && isProcessAlive(entry.pid)) {
        try { await this.stopOne(key) } catch { /* best effort */ }
      }
    }

    await sleep(500)

    const failed = []
    let registryResult = null
    try {
      logger.info('Restarting registry...')
      registryResult = await this.start(registryEntry.filepath, { internal: registryEntry.internal || false, ...options })
    } catch (err) {
      failed.push({ type: 'registry', filepath: registryEntry.filepath, error: err })
      logger.error(`Failed to restart registry: ${err.message}`)
    }
    await sleep(500)

    const serviceResults = []
    for (const dep of dependentEntries) {
      if (dep.status === 'stopped' && !dep.pid) continue
      logger.info(`Restarting ${dep.filepath}...`)
      try {
        const result = await this.start(dep.filepath, { internal: dep.internal || false, ...options })
        serviceResults.push(result)
      } catch (err) {
        failed.push({ type: 'service', filepath: dep.filepath, error: err })
        logger.error(`Failed to restart ${dep.filepath}: ${err.message}`)
      }
    }

    const nServices = serviceResults.length
    logger.info(
      `Registry ${registryResult ? 'restarted' : 'failed to restart'}; ${nServices} of ${dependentEntries.length} dependent process(es) restarted` +
        (failed.length ? ` (${failed.length} error(s))` : '')
    )
    return { registry: registryResult, services: serviceResults, failed, dependentCount: dependentEntries.length }
  }

  async list({ all = false } = {}) {
    const state = this.pruneDeadProcesses()
    const entries = []

    for (const key in state.processes) {
      const entry = state.processes[key]
      if (!all && entry.internal) continue
      if (!all && entry.status === 'stopped') continue
      entries.push({ ...entry, stateKey: key })
    }

    entries.sort((a, b) => {
      if (a.isRegistry && !b.isRegistry) return -1
      if (!a.isRegistry && b.isRegistry) return 1
      return 0
    })

    return entries
  }

  async status(target) {
    if (!target) throw new Error('target is required')
    const state = loadState()
    const { keys } = resolveTarget(state, target)
    if (keys.length === 0) return null

    const stateKey = keys[0]
    const entry = state.processes[stateKey]
    if (!entry) return null

    if (entry.pid && !isProcessAlive(entry.pid)) {
      entry.status = 'stopped'
      entry.pid = null
      saveState(state)
    }

    return entry
  }

  async delete(target) {
    if (!target) throw new Error('target is required')
    const state = this.pruneDeadProcesses()
    const { keys } = resolveTarget(state, target)

    if (keys.length === 0) {
      throw new Error(`No managed process found for "${target}"`)
    }

    for (const key of keys) {
      if (state.processes[key]?.pid && isProcessAlive(state.processes[key].pid)) {
        await this.stopOneFromState(state, key)
      }
    }

    const updated = loadState()
    for (const key of keys) {
      delete updated.processes[key]
    }
    saveState(updated)
    logger.info(`Deleted "${target}" from process list${keys.length > 1 ? ` (${keys.length} instances)` : ''}`)
  }

  async logs(target, { lines = 50 } = {}) {
    if (!target) throw new Error('target is required')
    const state = loadState()
    const { keys } = resolveTarget(state, target)
    const stateKey = keys[0]
    const entry = stateKey ? state.processes[stateKey] : null

    if (!entry) throw new Error(`No process found for "${target}"`)

    const logFile = entry.logFile
    if (!logFile || !existsSync(logFile)) {
      logger.warn(`No log file found for ${entry.filepath}`)
      return ''
    }

    const content = readFileSync(logFile, 'utf8')
    if (lines) {
      const allLines = content.split('\n')
      return allLines.slice(-lines).join('\n')
    }
    return content
  }

  logFiles({ all = false } = {}) {
    const state = this.pruneDeadProcesses()
    const results = []

    for (const key in state.processes) {
      const entry = state.processes[key]
      if (!all && entry.internal) continue
      if (!all && entry.status === 'stopped') continue
      results.push({
        stateKey: key,
        filepath: entry.filepath,
        logFile: entry.logFile || null
      })
    }

    return results
  }

  /**
   * Look up the filepath for a known service name from state.
   * Returns the filepath if found, null otherwise.
   */
  filepathForService(serviceName) {
    this.pruneDeadProcesses()
    const state = loadState()
    const raw = resolveByServiceName(state, serviceName)
    const keys = filterActiveProcessKeys(state, raw)
    if (keys.length === 0) return null
    return state.processes[keys[0]].filepath
  }

  /**
   * SIGTERM every process in `keys` that is still running, then wait on a *shared* grace window
   * (wall time ≈ one `getStopGraceAfterSigtermMs()` slice, not N × slice). Stragglers get SIGKILL.
   * Non-registry and registry are handled in two phases so bootstrap can outlast app shutdown.
   */
  async _stopKeyGroupSharedGrace (state, keys) {
    const active = []
    for (const key of keys) {
      const entry = state.processes[key]
      if (entry?.pid && isProcessAlive(entry.pid)) {
        active.push({ key, pid: entry.pid, filepath: entry.filepath })
      }
    }
    if (active.length === 0) return

    for (const { pid } of active) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        logger.warn(`Process ${pid} already dead`)
      }
    }

    const maxWaitMs = getStopGraceAfterSigtermMs()
    const termSleep = this.getStopSigtermPollMs()
    const deadline = Date.now() + maxWaitMs
    let pending = active.map((a) => ({ ...a }))

    while (pending.length > 0 && Date.now() < deadline) {
      await sleep(termSleep)
      pending = pending.filter(({ pid, key }) => {
        if (!isProcessAlive(pid)) {
          const e = state.processes[key]
          if (e) {
            e.pid = null
            e.status = 'stopped'
          }
          return false
        }
        return true
      })
    }

    for (const { pid } of pending) {
      logger.warn(`Process ${pid} did not exit after SIGTERM, sending SIGKILL`)
      try { process.kill(pid, 'SIGKILL') } catch { /* already dead */ }
    }
    if (pending.length > 0) {
      await sleep(100)
    }
    for (const { key } of pending) {
      const e = state.processes[key]
      if (e) {
        e.pid = null
        e.status = 'stopped'
      }
    }

    saveState(state)

    for (const { pid, filepath } of active) {
      logger.info(`Stopped ${filepath} (PID: ${pid})`)
    }
  }

  /**
   * Stops all managed processes: dependents first (parallel grace — see `_stopKeyGroupSharedGrace`),
   * then registry-tagged row(s) last, matching previous registry-last ordering.
   * When a registry URL is available, asks it to `REGISTRY_BROADCAST_SHUTDOWN` first (same as
   * `restart` when the target is the registry): HTTP SERVICE_SHUTDOWN to registered services while
   * the registry is still up, then PM3 OS-level stop for any remaining PIDs.
   */
  async stopAll () {
    const s0 = this.pruneDeadProcesses()
    const hasRunning = Object.values(s0.processes).some(
      (e) => e?.pid && isProcessAlive(e.pid)
    )
    if (hasRunning && this.shouldUseRegistryBroadcastStop()) {
      const ok = await this.tryRegistryBroadcastShutdown('yamf-stop-all')
      if (ok) {
        const settle = Number(envConfig.get('YAMF_PM3_BROADCAST_SETTLE_MS', 1500))
        await sleep(settle)
      }
    }
    const state = this.pruneDeadProcesses()
    const keys = Object.keys(state.processes).sort((a, b) => {
      const aReg = state.processes[a]?.isRegistry ? 1 : 0
      const bReg = state.processes[b]?.isRegistry ? 1 : 0
      return aReg - bReg
    })
    const nonRegKeys = keys.filter((k) => !state.processes[k]?.isRegistry)
    const regKeys = keys.filter((k) => state.processes[k]?.isRegistry)

    try {
      await this._stopKeyGroupSharedGrace(state, nonRegKeys)
    } catch { /* best effort; continue to registry */ }
    const state2 = this.pruneDeadProcesses()
    try {
      await this._stopKeyGroupSharedGrace(state2, regKeys)
    } catch { /* best effort */ }
  }

  async deleteAll() {
    const state = loadState()
    state.processes = {}
    saveState(state)
    logger.info('Cleared all processes from state')
  }
}
