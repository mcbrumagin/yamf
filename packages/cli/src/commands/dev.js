import chokidar from 'chokidar'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  publishMessage,
  PUBSUB_CHANNEL_YAMF_DEV_RELOAD,
  httpRequest,
  HEADERS,
  COMMANDS
} from '@yamf/core'
import { loadYamfConfig } from '../lib/load-yamf-config.js'
import { buildServiceEntry } from './build.js'
import { planAndApply } from '../lib/deploy-driver.js'
import { createRemotePm3 } from '../lib/remote-pm3-adapter.js'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEV_BOOTSTRAP_PATH = join(__dirname, '..', 'lib', 'dev-bootstrap.js')

/** Align with dev-bootstrap default so `yamf dev` works without a prior `yamf init --dev` when the stack was stopped. */
const DEFAULT_LOCAL_REGISTRY_URL = 'http://127.0.0.1:20000'

async function isRegistryReachable (registryUrl) {
  try {
    await httpRequest(registryUrl, {
      headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL }
    })
    return true
  } catch {
    return false
  }
}

const ARGS = {
  help: { flags: ['-h', '--help'] },
  remote: { flags: ['-r', '--remote'] },
  env: { flags: ['-e', '--env'], type: 'string' }
}

function getHelp () {
  return `
yamf dev — watch service entries and redeploy (Phase 3 D1; Phase 4 D2 reload pub/sub)

Options:
  -r, --remote   Remote PM3 (set YAMF_REGISTRY_URL and YAMF_DEPLOY_TOKEN for upload)
  -e, --env       Config-service / deploy env key (default: dev)
  -h, --help      This help

Local: if the registry is not reachable (e.g. after yamf stop --all), the same dev stack as
yamf init --dev is started automatically so you can re-run yamf dev without re-initializing.

After each successful build/deploy, publishes ${PUBSUB_CHANNEL_YAMF_DEV_RELOAD} so
@yamf/services-dev-hmr (when running with YAMF_DEV=on) can push SSE reload to browsers.
Set YAMF_DEV_RELOAD_LOG=1 to log pub/sub errors (e.g. registry unreachable).
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
  const debounceMs = Number(process.env.YAMF_DEV_DEBOUNCE_MS || 200)
  const envTarget = options.env || 'dev'
  const remote = !!options.remote

  if (remote && !process.env.YAMF_REGISTRY_URL) {
    throw new Error('YAMF_REGISTRY_URL is required for yamf dev --remote')
  }
  const registryUrl =
    process.env.YAMF_REGISTRY_URL || (!remote ? DEFAULT_LOCAL_REGISTRY_URL : null)
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is required for yamf dev')
  }
  process.env.YAMF_REGISTRY_URL = registryUrl

  let pm3
  if (remote) {
    pm3 = createRemotePm3({ registryUrl })
  } else {
    pm3 = new PM3()
    if (!(await isRegistryReachable(registryUrl))) {
      process.stdout.write(
        `[dev] Registry not reachable at ${registryUrl}; starting dev stack (same as yamf init --dev)…\n`
      )
      await pm3.start(DEV_BOOTSTRAP_PATH, { env: { YAMF_REGISTRY_URL: registryUrl } })
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
            deployToken: process.env.YAMF_DEPLOY_TOKEN
          })
          process.stdout.write(`[dev] ${svc.name} ${res.decision} ${String(hash).slice(0, 16)}\n`)
          try {
            await publishMessage(PUBSUB_CHANNEL_YAMF_DEV_RELOAD, {
              service: svc.name,
              hash: String(hash),
              at: Date.now(),
              source: 'yamf-dev'
            })
          } catch (pubErr) {
            if (process.env.YAMF_DEV_RELOAD_LOG === '1') {
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

  const entries = cfg.services.filter((s) => !s.internal).map((s) => s.entry)
  const watcher = chokidar.watch(entries, {
    ignored: ['**/node_modules/**', '**/.yamf/**'],
    ignoreInitial: true,
    // Avoid double-billing builds from editor atomic save (tmp → rename) or rapid writes
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
  })
  watcher.on('all', (_e, p) => {
    for (const svc of cfg.services) {
      if (!svc.internal && p.endsWith(svc.entry)) {
        trigger(svc)
      }
    }
  })
  for (const svc of cfg.services) {
    trigger(svc)
  }
}
