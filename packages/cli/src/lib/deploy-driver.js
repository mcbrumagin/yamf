/**
 * Shared deploy planning (Phase 2 — local; later: same function for remote with a different pm3 adapter).
 *
 * Cross-cut 6 (dev/prod parity): keep decision logic here; only `registryUrl` / process transport should differ.
 */

import {
  httpRequest,
  HEADERS,
  COMMANDS,
  deployDecisionFromReplicas,
  signDeployHashWithEd25519Pem
} from '@yamf/core'
import { checkDeployContractGate } from '@yamf/core/contract-compatibility'
import { loadIncomingServiceContractFromBundle } from './contract-from-bundle.js'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve as pathResolve, sep } from 'node:path'
import { getServiceBuildDir } from './yamf-paths.js'

/**
 * Local helper for identifying running PM3 bundles under `.yamf/build/{serviceName}`.
 * Keeps pruning and rolling-target lookup aligned.
 * @param {import('./pm3.js').PM3} pm3
 * @param {string} serviceName
 * @param {string} cwd
 * @param {string} [excludeBundlePath]
 */
async function listRunningLocalBundlesInServiceDir (pm3, serviceName, cwd, excludeBundlePath) {
  if (!pm3 || typeof pm3.list !== 'function') return []
  const outDir = pathResolve(getServiceBuildDir(serviceName, cwd)) + sep
  const keep = excludeBundlePath ? pathResolve(String(excludeBundlePath)) : ''
  let entries
  try {
    entries = await pm3.list({ all: true })
  } catch {
    return []
  }
  return entries.filter((e) => {
    if (e?.status !== 'running' || e?.internal || !e?.filepath) return false
    const fp = pathResolve(String(e.filepath))
    if (!fp.startsWith(outDir) || !fp.endsWith('.mjs')) return false
    if (keep && fp === keep) return false
    return true
  })
}

/**
 * yamf dev: REGISTRY_PULL may have no replica rows, but a Node process from an older .mjs in
 * .yamf/build/&lt;service&gt; can still be running and holding the port (e.g. `rm -rf .yamf` does not
 * SIGTERM). Before rollout `pm3.start`, remove PM3-managed other bundles in that directory.
 * @param {import('./pm3.js').PM3} pm3
 * @param {string} serviceName
 * @param {string} cwd
 * @param {string} keepBundlePath
 */
export async function pruneStalePm3BundlesInServiceDir (pm3, serviceName, cwd, keepBundlePath) {
  if (!pm3 || !keepBundlePath) return
  const outDir = pathResolve(getServiceBuildDir(serviceName, cwd))
  const entries = await listRunningLocalBundlesInServiceDir(pm3, serviceName, cwd, keepBundlePath)
  for (const e of entries) {
    if (e?.stateKey == null) continue
    const fp = pathResolve(String(e.filepath))
    try {
      await pm3.delete(e.stateKey)
      process.stdout.write(
        `[yamf] Stopped previous bundle in ${outDir} before rollout: ${fp}\n`
      )
    } catch (err) {
      process.stderr.write(
        `[yamf] Could not stop stale bundle ${fp}: ${err?.message || err}\n`
      )
    }
  }
}

/**
 * `restartRolling(replicaKey)` needs PM3 state with `entry.services[replicaKey]` set by
 * post-start registry polling, which can time out. Resolve the running bundle path under
 * `.yamf/build/{serviceName}/` instead so rolling works in `yamf dev` regardless.
 * @param {import('./pm3.js').PM3} pm3
 * @param {string} serviceName
 * @param {string} cwd
 * @param {string} newBundlePath
 * @param {string} replicaKey
 * @param {boolean} [remote]
 */
export async function resolveLocalRollingTarget (pm3, serviceName, cwd, newBundlePath, replicaKey, remote = false) {
  if (remote || !pm3) return replicaKey
  if (pm3.filepathForService) {
    try {
      const byName = pm3.filepathForService(replicaKey)
      if (byName) return byName
    } catch { /* */ }
  }
  if (!newBundlePath) return replicaKey
  const entries = await listRunningLocalBundlesInServiceDir(pm3, serviceName, cwd, newBundlePath)
  if (entries[0]?.filepath) return entries[0].filepath
  return replicaKey
}

/**
 * Stream local bundle to registry `deploy-bundle` (slice C3).
 * @param {{ registryUrl: string, hash: string, bundlePath: string, deployToken?: string }} p
 */
export async function uploadDeployBundleToRegistry ({ registryUrl, hash, bundlePath, deployToken = process.env.YAMF_DEPLOY_TOKEN || '' }) {
  if (!deployToken) {
    throw new Error('YAMF_DEPLOY_TOKEN is required to upload a bundle to the registry')
  }
  const base = String(registryUrl).replace(/\/$/, '')
  const deployHeaders = {
    [HEADERS.COMMAND]: 'deploy-bundle',
    [HEADERS.DEPLOY_TOKEN]: deployToken,
    [HEADERS.DEPLOY_HASH]: hash,
    'content-type': 'application/javascript; charset=utf-8'
  }
  const signPath = process.env.YAMF_DEPLOY_PRIVATE_KEY
  if (signPath) {
    try {
      deployHeaders[HEADERS.BUNDLE_ED25519_SIG] = signDeployHashWithEd25519Pem(hash, signPath)
    } catch (e) {
      throw new Error(`YAMF_DEPLOY_PRIVATE_KEY sign failed: ${e?.message || e}`)
    }
  }
  const bundleBody = readFileSync(bundlePath)
  const res = await fetch(base, {
    method: 'POST',
    headers: deployHeaders,
    body: bundleBody
  })
  if (!res.ok) {
    const t = await res.text()
    let msg = t
    try {
      const j = JSON.parse(t)
      if (j?.message) msg = j.message
    } catch { /* */ }
    throw new Error(`Bundle upload failed: ${res.status} ${msg}`)
  }
  return res.json()
}

/**
 * Fetch config values for a service from config-service (optional).
 * @param {string} registryUrl
 * @param {string} registryToken
 * @param {string} serviceName
 * @param {string} envName
 * @returns {Promise<{ values: Record<string, string>, version: string }>}
 */
export async function fetchConfigOverlay ({ registryUrl, registryToken, serviceName, envName }) {
  const headers = {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
    [HEADERS.SERVICE_NAME]: 'config-service',
    'content-type': 'application/json',
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
  const body = {
    command: 'get',
    service: serviceName,
    env: envName
  }
  const resp = await httpRequest(registryUrl, { method: 'POST', headers, body })
  return {
    values: resp.values && typeof resp.values === 'object' ? resp.values : {},
    version: resp.version != null ? String(resp.version) : ''
  }
}

/**
 * Merge required env names: config-service first, then `process.env` for any still missing.
 * @param {string[]} requiredNames
 * @param {Record<string, string>} overlay
 */
export function mergeRequiredEnvFromProcess (requiredNames, overlay) {
  const out = { ...overlay }
  for (const k of requiredNames) {
    if (out[k] == null || out[k] === '') {
      if (process.env[k] != null && process.env[k] !== '') {
        out[k] = process.env[k]
      }
    }
  }
  return out
}

/**
 * @param {object} args
 * @param {import('./load-yamf-config.js').YamfConfigService} args.yamfService
 * @param {string} args.hash
 * @param {import('./pm3.js').PM3} args.pm3
 * @param {string} args.registryUrl
 * @param {string} [args.registryToken]
 * @param {string} [args.envTarget='local']
 * @param {number} [args.replicas]
 * @param {string} [args.cwd]
 * @param {boolean} [args.remote] - If true, stream bundle to registry before pm3; uses {@link createRemotePm3} transport.
 * @param {string} [args.deployToken]
 * @param {boolean} [args.fromYamfDev] - yamf dev: ignore noop if no PM3 process runs the bundle (stale replica row)
 * @param {string} [args.configRoot] - Absolute project root (yamf `root` + cwd). Sets {@code YAMF_ENTRY_DIR} so bundled
 *   entries can resolve `public/` and other paths next to the source entry, not under `.yamf/build/`.
 * @param {boolean} [args.dryRun] - Cross-cut 2: do not upload or start; print contract diff result
 * @param {boolean} [args.allowBreaking] - allow deploy / replica registration when contract is not backward compatible
 */
export async function planAndApply ({
  yamfService,
  hash,
  pm3,
  registryUrl,
  registryToken = process.env.YAMF_REGISTRY_TOKEN || '',
  envTarget = 'local',
  replicas: replicasOverride,
  cwd = process.cwd(),
  remote = false,
  deployToken = process.env.YAMF_DEPLOY_TOKEN || '',
  fromYamfDev = false,
  configRoot,
  dryRun = false,
  allowBreaking = false
}) {
  const pull = await httpRequest(registryUrl, {
    headers: {
      [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
      ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
    }
  })
  const serviceName = yamfService.name
  /** @see {import('./load-yamf-config.js').YamfConfigService#replicaKey} */
  const replicaKey = yamfService.replicaKey || yamfService.name
  let current = pull.replicas?.[replicaKey] || []
  const wantReplicas = replicasOverride ?? yamfService.replicas ?? 1

  let { decision, sameHash, otherHash } = deployDecisionFromReplicas(current, hash, wantReplicas)

  if (decision === 'noop' && fromYamfDev && !remote && pm3 && typeof pm3.list === 'function') {
    const bundlePathSanity = join(getServiceBuildDir(serviceName, cwd), `${hash}.mjs`)
    let hasRunning = false
    try {
      const entries = await pm3.list({ all: true })
      hasRunning = entries.some(
        (e) => e?.status === 'running' && e?.filepath
          && pathResolve(String(e.filepath)) === pathResolve(bundlePathSanity)
      )
    } catch { /* */ }
    if (!hasRunning) {
      process.stderr.write(
        '[dev] Registry says replica(s) for this hash exist, but no running PM3 process has this bundle; redeploying.\n'
      )
      const r2 = deployDecisionFromReplicas([], hash, wantReplicas)
      decision = r2.decision
      sameHash = r2.sameHash
      otherHash = r2.otherHash
      current = r2.current
    }
  }

  if (decision === 'noop') {
    if (dryRun) {
      return { decision, dryRun: true, replicas: sameHash.length, contract: { skipped: 'no deploy needed (already at this hash)' } }
    }
    return { decision, replicas: sameHash.length }
  }

  const bundlePath = join(getServiceBuildDir(serviceName, cwd), `${hash}.mjs`)
  try {
    readFileSync(bundlePath)
  } catch {
    throw new Error(
      `Bundle missing: ${bundlePath}. Run \`yamf build ${serviceName}\` first.`
    )
  }

  const yamfEntryDir =
    configRoot && yamfService.entry
      ? pathResolve(configRoot, dirname(yamfService.entry))
      : null

  let incomingContract
  try {
    incomingContract = await loadIncomingServiceContractFromBundle(bundlePath, {
      ...(yamfEntryDir ? { yamfEntryDir } : {})
    })
  } catch (e) {
    throw new Error(
      `Could not load service contract from bundle (cross-cut 2): ${e?.message || e}`
    )
  }
  const currentContract = pull.serviceContracts?.[serviceName] ?? null
  const gate = checkDeployContractGate(currentContract, incomingContract, { allowBreaking: !!allowBreaking })
  if (dryRun) {
    return {
      decision,
      dryRun: true,
      contract: {
        current: currentContract,
        incoming: incomingContract,
        allowed: gate.allowed,
        reason: gate.reason,
        diffSummary: gate.diff?.summary,
        diffLines: gate.diff?.lines
      }
    }
  }
  if (!gate.allowed) {
    const extra = (gate.diff?.lines || []).join('\n')
    throw new Error(`${gate.reason}\n${extra}`)
  }

  if (remote) {
    await uploadDeployBundleToRegistry({ registryUrl, hash, bundlePath, deployToken })
  }

  let env = {
    YAMF_SOURCE_HASH: hash,
    YAMF_BUNDLE_PATH: bundlePath,
    YAMF_SERVICE_NAME: serviceName,
    ...(allowBreaking && { YAMF_DEPLOY_ALLOW_BREAKING: '1' })
  }
  if (yamfEntryDir) {
    env.YAMF_ENTRY_DIR = yamfEntryDir
  }

  const required = yamfService.env || []
  if (required.length) {
    try {
      const { values, version } = await fetchConfigOverlay({
        registryUrl,
        registryToken,
        serviceName,
        envName: envTarget
      })
      Object.assign(env, mergeRequiredEnvFromProcess(required, values))
      if (version) env.YAMF_CONFIG_VERSION = version
    } catch (e) {
      Object.assign(env, mergeRequiredEnvFromProcess(required, {}))
      const missing = required.filter((k) => env[k] == null || env[k] === '')
      if (missing.length) {
        throw new Error(
          `Missing env for ${serviceName}: ${missing.join(', ')}. ` +
          `Set them in the shell or start config-service (see @yamf/services-config). Underlying: ${e.message}`
        )
      }
    }
  }

  if (decision === 'rollout' || decision === 'scale') {
    const want = wantReplicas - sameHash.length
    if (want <= 0) {
      return { decision: 'noop', replicas: sameHash.length }
    }
    if (decision === 'rollout' && fromYamfDev && !remote && pm3) {
      await pruneStalePm3BundlesInServiceDir(pm3, serviceName, cwd, bundlePath)
    }
    for (let i = 0; i < want; i++) {
      await pm3.start(bundlePath, { env })
    }
    return { decision, added: want }
  }

  // rolling — default target is replicaKey, but local PM3 only finds it if `entry.services[replicaKey]`
  // was filled by post-start poll (unreliable). Fall back to the running .mjs path under
  // .yamf/build/{serviceName}/.
  const rollingTarget = await resolveLocalRollingTarget(
    pm3, serviceName, cwd, bundlePath, replicaKey, remote
  )
  const result = await pm3.restartRolling(rollingTarget, { env, bundlePath })
  return { decision, replaced: result.replaced?.length ?? 0, pm3: result }
}
