import chokidar from 'chokidar'
import { loadYamfConfig } from '../lib/load-yamf-config.js'
import { buildServiceEntry } from './build.js'
import { planAndApply } from '../lib/deploy-driver.js'
import { createRemotePm3 } from '../lib/remote-pm3-adapter.js'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'

const ARGS = {
  help: { flags: ['-h', '--help'] },
  remote: { flags: ['-r', '--remote'] },
  env: { flags: ['-e', '--env'], type: 'string' }
}

function getHelp () {
  return `
yamf dev — watch service entries and redeploy (Phase 3 D1 / ROADMAP)

Options:
  -r, --remote   Remote PM3 (set YAMF_REGISTRY_URL and YAMF_DEPLOY_TOKEN for upload)
  -e, --env       Config-service / deploy env key (default: dev)
  -h, --help      This help
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
  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is required for yamf dev')
  }
  const debounceMs = Number(process.env.YAMF_DEV_DEBOUNCE_MS || 200)
  const envTarget = options.env || 'dev'
  const remote = !!options.remote
  const pm3 = remote
    ? createRemotePm3({ registryUrl })
    : new PM3()
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
        } catch (err) {
          process.stderr.write(`[dev] ${svc.name} failed: ${err?.message || err}\n`)
        }
      }, debounceMs)
    )
  }

  const entries = cfg.services.filter((s) => !s.internal).map((s) => s.entry)
  const watcher = chokidar.watch(entries, { ignored: ['**/node_modules/**', '**/.yamf/**'], ignoreInitial: true })
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
