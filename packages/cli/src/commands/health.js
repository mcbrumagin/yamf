import { httpRequest, COMMANDS, HEADERS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  verbose:   { flags: ['-v', '--verbose'] },
}

function getHealthHelp() {
  return `
yamf health - Get health of yamf environment

Usage:
  yamf health [options]

Options:
  -v, --verbose            Verbose output
  -h, --help               Show this help
`
}

export async function runHealthCommand(args) {
  const options = parseArgs(args, ARGS)
  
  if (options.help) {
    console.log(getHealthHelp())
    return
  }

  const result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
    headers: {
      [HEADERS.COMMAND]: COMMANDS.HEALTH
    }
  })
  
  logger.info('health:', result)
  return result
}
