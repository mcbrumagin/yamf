import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { loadYamfConfig } from '../lib/load-yamf-config.js'
import { getServiceBuildDir, getYamfHome } from '../lib/yamf-paths.js'
import { planAndApply } from '../lib/deploy-driver.js'
import { PM3 } from '../lib/pm3.js'
import { createRemotePm3 } from '../lib/remote-pm3-adapter.js'

const logger = new Logger()

const ARGS = {
  help: { flags: ['-h', '--help'] },
  local: { flags: ['--local'] },
  remote: { flags: ['-r', '--remote'] },
  hash: { flags: ['--hash'], type: 'string' },
  env: { flags: ['-e', '--env'], type: 'string' },
  replicas: { flags: ['-i', '--replicas'], type: 'number' },
  rollback: { flags: ['--rollback'], type: 'string' },
  force: { flags: ['--force'] }
}

function getDeployHelp () {
  return `
  yamf deploy - Plan and apply a deploy (local or remote, slice C3)

Usage:
  yamf deploy --local <service> [options]
  yamf deploy --remote <service> [options]

Example:
  yamf deploy --remote my-service

Requires:
  - yamf.config.js with the service
  - A prior \`yamf build <name>\` (or --hash / --rollback to an existing .mjs under .yamf/build)
  - YAMF_REGISTRY_URL (remote: YAMF_DEPLOY_TOKEN to upload; optional YAMF_DEPLOY_PRIVATE_KEY for Ed25519 \`yamf-bundle-ed25519-sig\` when registry has authorized_keys; optional YAMF_PM3_SERVICE_LOCATION to pin pm3-service for SERVICE_CALL)

Options:
  --local          Local deploy via pm3
  -r, --remote     Remote deploy: upload bundle to registry, drive pm3-service
  -e, --env NAME   Config-service environment key (default: local)
  --hash HASH      Content hash (default: read .yamf/build/<name>/latest.json)
  --rollback HASH  Shorthand: deploy that hash; fails if the bundle file is missing locally
  -i, --replicas N Override replica count
  --force          Reserved for non-noop when hashes match
  -h, --help
`
}

export async function runDeployCommand (args) {
  const options = parseArgs(args, ARGS)
  if (options.help) {
    console.log(getDeployHelp())
    return
  }
  const remote = !!options.remote
  if (!options.local && !remote) {
    throw new Error('Specify `--local` or `--remote` (see yamf deploy --help).')
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

  let hash = options.rollback || options.hash
  if (options.rollback) {
    const bundlePath = join(getServiceBuildDir(name, cwd), `${options.rollback}.mjs`)
    if (!existsSync(bundlePath)) {
      const code = 'no-bundle-for-rollback-hash'
      throw new Error(
        `${code}: missing ${bundlePath}. Build or copy that hash before rollback.`
      )
    }
    hash = options.rollback
  }
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

  const pm3 = remote ? createRemotePm3({ registryUrl }) : new PM3()
  const result = await planAndApply({
    yamfService,
    hash,
    pm3,
    registryUrl,
    registryToken: process.env.YAMF_REGISTRY_TOKEN || '',
    envTarget: options.env || 'local',
    replicas: options.replicas,
    cwd,
    remote,
    deployToken: process.env.YAMF_DEPLOY_TOKEN
  })
  if (options.rollback) {
    result.rollback = true
  }
  logger.info('Deploy result:', result)
  console.log(JSON.stringify(result, null, 2))
}
