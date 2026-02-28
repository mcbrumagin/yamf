import { httpRequest, COMMANDS, HEADERS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  verbose:   { flags: ['-v', '--verbose'] },
  authToken: { flags: ['-a', '--auth'], type: 'string' }
}

function getStateHelp() {
  return `
yamf state - Get property or all of registry state

Usage:
  yamf state <property> [options]

Options:
  -a, --auth <token>       Authentication token
  -v, --verbose            Verbose output
  -h, --help               Show this help
`
}

export async function runStateCommand(args) {
  const options = parseArgs(args, ARGS)
  const property = options._positional[0]
  
  if (options.help) {
    console.log(getStateHelp())
    return
  }

  const result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
    headers: {
      [HEADERS.AUTH_TOKEN]: options.authToken,
      [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL
    }
  })

  if (property && result[property] !== undefined) {
    logger.info(`state.${property}:`, JSON.stringify(result[property], null, 2))
  } else {
    logger.info('state:', JSON.stringify(result, null, 2))
  }

  return result
}
