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

function getStateHelp () {
  return `
yamf registry state - Get property or all of registry state

Usage:
  yamf registry state <property> [options]

Options:
  --auth user:pass      Log in via the auth service; use returned token for this request
  --token <bearer>      Send an existing bearer as yamf-auth-token
  -v, --verbose         Verbose output
  -h, --help            Show this help
`
}

export async function runStateCommand (args) {
  const options = parseArgs(args, ARGS)
  const property = options._positional[0]

  if (options.help) {
    console.log(getStateHelp())
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
    [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL
  }
  if (process.env.YAMF_REGISTRY_TOKEN) {
    headers[HEADERS.REGISTRY_TOKEN] = process.env.YAMF_REGISTRY_TOKEN
  }
  if (authToken) headers[HEADERS.AUTH_TOKEN] = authToken

  const result = await httpRequest(registryUrl, { headers })

  if (property && result[property] !== undefined) {
    logger.info(`state.${property}:`, JSON.stringify(result[property], null, 2))
  } else {
    logger.info('state:', JSON.stringify(result, null, 2))
  }

  return result
}
