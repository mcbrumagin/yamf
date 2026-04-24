import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { loadYamfConfig } from '../lib/load-yamf-config.js'
import { getServiceBuildDir, getYamfHome } from '../lib/yamf-paths.js'
import { planAndApply } from '../lib/deploy-driver.js'
import { PM3 } from '../lib/pm3.js'

const logger = new Logger()

const ARGS = {
  help: { flags: ['-h', '--help'] },
  local: { flags: ['--local'] },
  remote: { flags: ['-r', '--remote'], type: 'string' },
  hash: { flags: ['--hash'], type: 'string' },
  env: { flags: ['-e', '--env'], type: 'string' },
  replicas: { flags: ['-i', '--replicas'], type: 'number' }
}

function getDeployHelp () {
  return `
yamf deploy - Plan and apply a deploy (local in Phase 2; remote in Phase 3 / C3)

Usage:
  yamf deploy --local <service-name> [options]

Requires:
  - yamf.config.js with the service
  - A prior \`yamf build <name>\` (or --hash pointing at an existing .mjs under .yamf/build)
  - YAMF_REGISTRY_URL (registry must be reachable)

Options:
  --local          Local deploy via pm3 (Phase 2; default path today)
  -r, --remote H   Not implemented — remote rollout is **Phase 3 / slice C3** (see yamf/docs/ROADMAP.md)
  -e, --env NAME   Config-service environment key (default: local)
  --hash HASH      Use this content hash (default: read .yamf/build/<name>/latest.json)
  -i, --replicas N Override replica count from the manifest
  -h, --help       Show this help
`
}

export async function runDeployCommand (args) {
  const options = parseArgs(args, ARGS)
  if (options.help) {
    console.log(getDeployHelp())
    return
  }
  if (options.remote) {
    throw new Error(
      '`yamf deploy --remote` is not implemented. Remote deploy is **Phase 3 / slice C3** (pm3-service + registry bundle store). ' +
        'Use `yamf deploy --local <service>` for now. See yamf/docs/ROADMAP.md.'
    )
  }
  if (!options.local) {
    throw new Error('Specify `--local` for a local deploy, or see ROADMAP Phase 3 for future `--remote`.')
  }
  const name = options._positional[0]
  if (!name) {
    throw new Error('Service name is required. Example: yamf deploy --local my-service')
  }
  const cfg = await loadYamfConfig()
  if (!cfg) {
    throw new Error('yamf.config.js not found')
  }
  const yamfService = cfg.services.find((s) => s.name === name)
  if (!yamfService) {
    throw new Error(`Service "${name}" not in yamf.config.js`)
  }
  if (yamfService.internal) {
    throw new Error('Cannot deploy internal services from the manifest')
  }
  const cwd = process.cwd()
  getYamfHome(cwd)

  let hash = options.hash
  if (!hash) {
    const latestPath = join(getServiceBuildDir(name, cwd), 'latest.json')
    if (!existsSync(latestPath)) {
      throw new Error(`No build found. Run: yamf build ${name}`)
    }
    const latest = JSON.parse(readFileSync(latestPath, 'utf8'))
    hash = latest.hash
    if (!hash) {
      throw new Error(`Invalid latest.json in ${getServiceBuildDir(name, cwd)}`)
    }
  }

  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is required')
  }

  const pm3 = new PM3()
  const result = await planAndApply({
    yamfService,
    hash,
    pm3,
    registryUrl,
    registryToken: process.env.YAMF_REGISTRY_TOKEN || '',
    envTarget: options.env || 'local',
    replicas: options.replicas,
    cwd
  })
  logger.info('Deploy result:', result)
  console.log(JSON.stringify(result, null, 2))
}
