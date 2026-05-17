import { callService, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { resolveCliRegistryToken } from '../lib/resolve-cli-auth.js'

const logger = new Logger({ maxDepth: 10 }) // TODO configurable from CLI

const ARGS = {
  help: { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  payload: { flags: ['-p', '--payload'], type: 'string' },
  file: { flags: ['-f', '--file'], type: 'string' },
  contentType: { flags: ['--data-type'], type: 'string', default: 'application/json' },
  auth: { flags: ['--auth'], type: 'string' },
  token: { flags: ['--token'], type: 'string' }
}

function getCallHelp () {
  return `
yamf call - Call a service

Usage:
  yamf call <service> [options]

Options:
  -p, --payload <json>      Payload to send to the service
  -f, --file <file>         File to send to the service
  --data-type <type>        Content type (default: application/json)
  --auth user:pass          Log in via the auth service; use token for this call
  --token <bearer>          Bearer token as yamf-auth-token
  -v, --verbose             Verbose output
  -h, --help                Show this help
`
}

export async function runCallCommand (args) {
  const options = parseArgs(args, ARGS)
  const service = options._positional[0]

  if (options.help) {
    console.log(getCallHelp())
    return
  }

  if (!service) {
    throw new Error('Service name is required. Usage: yamf call <service> [options]')
  }

  if (options.payload && options.file) {
    throw new Error('--payload and --file cannot be used together')
  }

  if (options.payload && options.contentType === 'application/json') {
    options.payload = JSON.parse(options.payload)
  }

  let authToken = null
  if (options.auth || options.token) {
    const registryUrl = process.env.YAMF_REGISTRY_URL
    if (!registryUrl) {
      throw new Error('YAMF_REGISTRY_URL is required when using --auth or --token')
    }
    authToken = await resolveCliRegistryToken(
      { auth: options.auth, token: options.token },
      registryUrl
    )
  }

  const result = await callService(service, options.payload, {
    contentType: options.contentType,
    authToken
  })

  logger.info('call service result:', result)
  return result
}
