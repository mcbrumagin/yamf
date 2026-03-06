import { httpRequest, COMMANDS, HEADERS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:       { flags: ['-h', '--help'] },
  verbose:    { flags: ['-v', '--verbose'] },
  searchType: { flags: ['-t', '--searchType'], type: 'string' },
  authToken:  { flags: ['-a', '--auth'], type: 'string' }
}

function getLookupHelp() {
  return `
yamf lookup - Lookup services, routes, or pubsub channels

Usage:
  yamf lookup <search> [options]

Options:
  -t, --searchType <type>     Search type: service, route, channel
  -a, --auth <token>          Authentication token
  -v, --verbose               Verbose output
  -h, --help                  Show this help
`
}

export async function runLookupCommand(args) {
  const options = parseArgs(args, ARGS)
  const search = options._positional[0]

  if (options.help) {
    console.log(getLookupHelp())
    return
  }

  const result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
    headers: {
      [HEADERS.AUTH_TOKEN]: options.authToken,
      [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
      // TODO - support other search types
      [HEADERS.SERVICE_NAME]: search ?? '*'
    }
  })

  logger.info('lookup result:', result)
  return result
}
