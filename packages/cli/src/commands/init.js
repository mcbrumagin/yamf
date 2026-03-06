import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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

  logger.info('Starting dev environment (registry + cache + pm3-service)...')
  await pm3.start(DEV_BOOTSTRAP_PATH) //, { internal: true }) // TODO
}
