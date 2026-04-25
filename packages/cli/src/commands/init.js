import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  DEFAULT_LOCAL_REGISTRY_URL,
  resolveLocalRegistryUrl,
  checkLocalRegistryBootstrapTarget
} from '../lib/registry-url.js'

const logger = new Logger()

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEV_BOOTSTRAP_PATH = join(__dirname, '..', 'lib', 'dev-bootstrap.js')

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  dev:     { flags: ['--dev'] },
  verbose: { flags: ['-v', '--verbose'] }
}

function getInitHelp() {
  return `
yamf init - Initialize yamf environment

Usage:
  yamf init --dev [options]

Flags:
  --dev                 Start local dev environment (registry + cache + pm3-service)

Options:
  -v, --verbose         Verbose output
  -h, --help            Show this help

Registry URL:
  Uses YAMF_REGISTRY_URL when set.
  Otherwise tries the last local PM3 state URL, then falls back to ${DEFAULT_LOCAL_REGISTRY_URL}.
`
}

export async function runInitCommand(args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getInitHelp())
    return
  }

  if (!options.dev) {
    console.error('Usage: yamf init --dev')
    console.error('Run "yamf init --help" for options.')
    process.exit(1)
  }

  const pm3 = new PM3()
  const { registryUrl, source } = resolveLocalRegistryUrl()
  process.env.YAMF_REGISTRY_URL = registryUrl

  const probe = await checkLocalRegistryBootstrapTarget(registryUrl)
  if (!probe.local) {
    throw new Error(
      `yamf init --dev expects a loopback registry URL, got "${registryUrl}". ` +
      `Set YAMF_REGISTRY_URL to a local URL (for example ${DEFAULT_LOCAL_REGISTRY_URL}).`
    )
  }
  if (probe.available === false) {
    throw new Error(
      `Cannot start dev bootstrap at ${registryUrl}: port is already in use. ` +
      'Likely an orphan process; run `yamf clean` (or stop the holder) and retry.'
    )
  }

  logger.info(
    `Starting dev environment (registry + cache + pm3-service) at ${registryUrl}` +
      (source === 'pm3-state' ? ' (from PM3 state)' : '')
  )
  await pm3.start(DEV_BOOTSTRAP_PATH, { env: { YAMF_REGISTRY_URL: registryUrl } }) //, { internal: true }) // TODO
}
