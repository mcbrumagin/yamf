import { httpRequest, COMMANDS, HEADERS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { resolveCliRegistryToken } from '../lib/resolve-cli-auth.js'

const logger = new Logger()

const ARGS = {
  help: { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  auth: { flags: ['--auth'], type: 'string' },
  token: { flags: ['--token'], type: 'string' }
}

function getLookupHelp () {
  return `
yamf registry lookup - Lookup services, routes, or pubsub channels

Usage:
  yamf registry lookup <search> [options]

Options:
  --auth user:pass      Log in via the auth service; use returned token for this request
  --token <bearer>      Send an existing bearer as yamf-auth-token
  -v, --verbose         Verbose output
  -h, --help            Show this help
`
}

export async function runLookupCommand (args) {
  const options = parseArgs(args, ARGS)
  const search = options._positional[0]

  if (options.help) {
    console.log(getLookupHelp())
    return
  }

  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is required')
  }

  const authToken = await resolveCliRegistryToken(
    { auth: options.auth, token: options.token },
    registryUrl
  )

  const headers = {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
    [HEADERS.SERVICE_NAME]: search ?? '*'
  }
  if (process.env.YAMF_REGISTRY_TOKEN) {
    headers[HEADERS.REGISTRY_TOKEN] = process.env.YAMF_REGISTRY_TOKEN
  }
  if (authToken) headers[HEADERS.AUTH_TOKEN] = authToken

  const result = await httpRequest(registryUrl, { headers })

  logger.info('lookup result:', result)
  return result
}
