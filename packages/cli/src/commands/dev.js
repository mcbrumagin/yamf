import { existsSync, statSync } from 'node:fs'
import chokidar from 'chokidar'
import { dirname, isAbsolute, resolve as pathResolve, sep } from 'node:path'
import {
  publishMessage,
  CHANNELS,
  envTruthy
} from '@yamf/core'
import { loadYamfConfig } from '../lib/load-yamf-config.js'
import { buildServiceEntry } from './build.js'
import { planAndApply } from '../lib/deploy-driver.js'
import { createRemotePm3 } from '../lib/remote-pm3-adapter.js'
import { PM3 } from '../lib/pm3.js'
import {
  DEFAULT_LOCAL_REGISTRY_URL,
  resolveLocalRegistryUrl,
  checkLocalRegistryBootstrapTarget
} from '../lib/registry-url.js'
import {
  ensureLocalDevStack,
  isRegistryReachable
} from '../lib/local-dev-stack.js'
import parseArgs from '../lib/parse-args.js'

let printedNoopHint = false

const ARGS = {
  help: { flags: ['-h', '--help'] },
  remote: { flags: ['-r', '--remote'] },
  env: { flags: ['-e', '--env'], type: 'string' }
}

/**
 * Optional first positional: service name (from yamf.config.js) or path to a service entry file.
 * @param {import('../lib/load-yamf-config.js').YamfConfig} cfg
 * @param {string} [token]
 * @param {string} cwd
 * @returns {import('../lib/load-yamf-config.js').YamfConfigService | null}
 */
function resolveDevServiceTarget (cfg, token, cwd) {
  if (!token) return null
  const list = (cfg.services || []).filter((s) => !s.internal)
  const byName = list.find((s) => s.name === token)
  if (byName) return byName
  const root = pathResolve(cwd, cfg.root || '.')
  const asPath = pathResolve(cwd, token)
  for (const s of list) {
    const abs = pathResolve(root, s.entry)
    if (abs === asPath || s.entry === token || abs.endsWith(token.replace(/^\.\//, ''))) {
      return s
    }
  }
  return null
}

function getHelp () {
  return `
yamf dev — watch service entries and redeploy (Phase 3 D1; Phase 4 D2 reload pub/sub)

  yamf dev [name-or-entry.mjs]   Watch only the matching service (name from yamf.config.js, or
                                   path to its entry file — same idea as yamf start path).

Options:
  -r, --remote   Remote PM3 (set YAMF_REGISTRY_URL and YAMF_DEPLOY_TOKEN for upload)
  -e, --env       Config-service / deploy env key (default: dev)
  -h, --help      This help

Local: if the registry is not reachable (e.g. after yamf stop --all), a dev stack (registry + cache
+ pm3-service via dev-bootstrap) is started automatically so you can re-run yamf dev without a
separate bootstrap step.
Default local registry URL is ${DEFAULT_LOCAL_REGISTRY_URL}.
If YAMF_REGISTRY_URL is unset, yamf dev will first try the last local PM3 registry URL from state.

After each successful build/deploy, publishes ${CHANNELS.DEV_RELOAD} so
@yamf/services-dev-hmr (dev-bootstrap) can push SSE reload to browsers. Dev-bootstrap is started
with YAMF_DEV=true when yamf dev starts the stack, so the yamf-dev service registers.

If you import from outside the service entry tree (e.g. ../lib next to src/app), set per-service
\`watch: ['src/lib', …]\` in yamf.config.js so \`yamf dev\` rebuilds on those file changes.

Browser full reload (Vite): set VITE_YAMF_DEV_HMR=true and point SOUNCLONE_VITE_DEV_HMR_TARGET (in .env)
at the yamf-dev base URL from \`yamf list\`. For the Vite plugin to publish the same channel on HMR,
run Vite with YAMF_REGISTRY_URL and YAMF_DEV=true. Set YAMF_DEV_RELOAD_LOG=true to log pub/sub errors; YAMF_DEV_WATCH_LOG=true to log which files trigger rebuilds;
YAMF_DEV_CHOKIDAR_POLL=true to poll the filesystem (e.g. bind mounts) if changes are not detected.
`
}

export async function runDevCommand (args) {
  const options = parseArgs(args, ARGS)
  if (options.help) {
    console.log(getHelp())
    return
  }
  const cfg = await loadYamfConfig()
  if (!cfg) {
    throw new Error('yamf.config.js not found')
  }
  const cwd = process.cwd()
  const projectRoot = pathResolve(cwd, cfg.root || '.')
  const targetToken = options._positional?.[0]
  const targetSvc = resolveDevServiceTarget(cfg, targetToken, cwd)
  if (targetToken && !targetSvc) {
    throw new Error(
      `yamf dev: no service in yamf.config.js matches "${targetToken}". ` +
        'Use a service name, or a path to the entry (e.g. src/app/app.js).'
    )
  }
  const devServices = targetSvc ? [targetSvc] : (cfg.services || []).filter((s) => !s.internal)
  const debounceMs = Number(process.env.YAMF_DEV_DEBOUNCE_MS || 200)
  const envTarget = options.env || 'dev'
  const remote = !!options.remote

  if (remote && !process.env.YAMF_REGISTRY_URL) {
    throw new Error('YAMF_REGISTRY_URL is required for yamf dev --remote')
  }
  const resolvedRegistry = remote ? null : resolveLocalRegistryUrl({ cwd })
  const registryUrl = process.env.YAMF_REGISTRY_URL || (!remote ? resolvedRegistry?.registryUrl : null)
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is required for yamf dev')
  }
  process.env.YAMF_REGISTRY_URL = registryUrl
  if (!remote && resolvedRegistry?.source === 'pm3-state') {
    process.stdout.write(`[dev] Using registry URL from PM3 state: ${registryUrl}\n`)
  }
  if (targetSvc) {
    process.stdout.write(`[dev] Watching only: ${targetSvc.name} (${targetSvc.entry})\n`)
  }

  let pm3
  if (remote) {
    pm3 = createRemotePm3({ registryUrl })
  } else {
    pm3 = new PM3()
    if (!(await isRegistryReachable(registryUrl))) {
      const probe = await checkLocalRegistryBootstrapTarget(registryUrl)
      if (!probe.local) {
        throw new Error(
          `[dev] Registry URL "${registryUrl}" is not loopback, so yamf dev cannot auto-start local dev-bootstrap for it. ` +
          'Set YAMF_REGISTRY_URL to a local URL (for example http://127.0.0.1:20000), or start that remote registry yourself.'
        )
      }
      if (probe.available === false) {
        throw new Error(
          `[dev] ${registryUrl} is not responding and the port is already in use. ` +
          'Likely orphan process or wrong service on that port. Run `yamf clean` (or stop the holder), then retry.'
        )
      }
      process.stdout.write(
        `[dev] Registry not reachable at ${registryUrl}; starting local dev stack…\n`
      )
      await ensureLocalDevStack(pm3, registryUrl, { yamfDev: true })
    }
  }
  const timers = new Map()

  const trigger = (svc) => {
    if (svc.internal) return
    clearTimeout(timers.get(svc.name))
    timers.set(
      svc.name,
      setTimeout(async () => {
        try {
          const { hash } = await buildServiceEntry(cfg, svc)
          const res = await planAndApply({
            yamfService: svc,
            hash,
            pm3,
            registryUrl,
            registryToken: process.env.YAMF_REGISTRY_TOKEN || '',
            envTarget,
            remote,
            deployToken: process.env.YAMF_DEPLOY_TOKEN,
            fromYamfDev: true,
            configRoot: projectRoot
          })
          process.stdout.write(`[dev] ${svc.name} ${res.decision} ${String(hash).slice(0, 16)}\n`)
          if (
            res.decision === 'noop' &&
            process.env.YAMF_DEV_NOOP_HINT !== '0' &&
            !printedNoopHint
          ) {
            printedNoopHint = true
            process.stdout.write(
              '[dev] noop: if your edits are not live, run `yamf delete --all` from the project root before `rm -rf .yamf`, or `pkill -f .yamf/build/` (removing .yamf alone does not stop Node).\n'
            )
          }
          try {
            await publishMessage(CHANNELS.DEV_RELOAD, {
              service: svc.name,
              hash: String(hash),
              at: Date.now(),
              source: 'yamf-dev'
            })
          } catch (pubErr) {
            if (envTruthy(process.env.YAMF_DEV_RELOAD_LOG)) {
              process.stderr.write(
                `[dev] ${svc.name} dev-reload pub/sub: ${pubErr?.message || pubErr}\n`
              )
            }
          }
        } catch (err) {
          process.stderr.write(`[dev] ${svc.name} failed: ${err?.message || err}\n`)
        }
      }, debounceMs)
    )
  }

  /** chokidar may emit relative paths; always resolve from project cwd. */
  function toAbsolutePath (rawPath) {
    const s = String(rawPath)
    return isAbsolute(s) ? pathResolve(s) : pathResolve(cwd, s)
  }
  /** A file change belongs to a service: same tree as entry, or (optional) `watch` path/dir. */
  function fileTriggersService (rawPath, svc) {
    const abs = toAbsolutePath(rawPath)
    const entryAbs = pathResolve(projectRoot, svc.entry)
    if (abs === entryAbs) return true
    const d = dirname(entryAbs) + sep
    if (abs.length > d.length && abs.startsWith(d)) return true
    if (Array.isArray(svc.watch)) {
      for (const w of svc.watch) {
        if (w.includes('*') || w.includes('?')) continue
        const wAbs = pathResolve(projectRoot, w)
        if (abs === wAbs) return true
        if (existsSync(wAbs)) {
          const st = statSync(wAbs)
          if (st.isDirectory() && (abs === wAbs || abs.startsWith(wAbs + sep))) return true
        }
      }
    }
    return false
  }

  // Watch the entry's directory tree (and optional `watch` paths) as real paths, not only **/*.ext globs —
  // chokidar can miss some glob patterns; recursive directory watch is the most reliable.
  const watchPaths = new Set()
  for (const svc of devServices) {
    const entryDir = dirname(pathResolve(projectRoot, svc.entry))
    watchPaths.add(entryDir)
    if (Array.isArray(svc.watch)) {
      for (const w of svc.watch) {
        if (w.includes('*') || w.includes('?')) {
          watchPaths.add(pathResolve(projectRoot, w))
        } else {
          const wAbs = pathResolve(projectRoot, w)
          if (existsSync(wAbs)) {
            watchPaths.add(wAbs)
          } else {
            process.stderr.write(`[dev] yamf.config watch path missing (skipping): ${wAbs}\n`)
          }
        }
      }
    }
  }
  const watchList = [...watchPaths]
  const watcher = chokidar.watch(watchList, {
    ignored: (pathStr) => {
      const s = String(pathStr).replace(/\\/g, '/')
      return s.includes('/node_modules/') || s.includes('/.yamf/') || s.endsWith('/node_modules') || s.endsWith('/.yamf')
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    ...(envTruthy(process.env.YAMF_DEV_CHOKIDAR_POLL) ? { usePolling: true, interval: 1000 } : {})
  })
  process.stdout.write(
    `[dev] File watcher on (${watchList.length} path(s)): ${watchList.join(', ')}\n`
  )
  watcher.on('all', (_e, p) => {
    const ap = toAbsolutePath(p)
    for (const svc of devServices) {
      if (fileTriggersService(ap, svc)) {
        if (envTruthy(process.env.YAMF_DEV_WATCH_LOG)) {
          process.stdout.write(`[dev] watch → ${svc.name} (${ap})\n`)
        }
        trigger(svc)
      }
    }
  })
  for (const svc of devServices) {
    trigger(svc)
  }
}
