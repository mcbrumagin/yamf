import { httpRequest, HEADERS, COMMANDS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help: { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  remove: { flags: ['--remove'] },
  dataType: { flags: ['--data-type'], type: 'string', default: 'application/json' },
  type: { flags: ['--type'], type: 'string', default: 'route' }
}

function getRouteHelp () {
  return `
yamf registry route - Register or unregister a route

Usage:
  yamf registry route <path> <service-name> [options]   Register a route
  yamf registry route <path> --remove                   Unregister a route

Options:
  --remove              Unregister the route instead of registering
  --data-type <type>    Content type (default: application/json)
  --type <type>         Route type: "route" (exact) or "controller" (prefix) (default: route)
  -v, --verbose         Verbose output
  -h, --help            Show this help

Examples:
  yamf registry route /health simple-service
  yamf registry route /api/users/* user-controller --type controller
  yamf registry route /health --remove
`
}

export async function runRouteCommand (args) {
  const options = parseArgs(args, ARGS)
  const routePath = options._positional[0]
  const serviceName = options._positional[1]

  if (options.help) {
    console.log(getRouteHelp())
    return
  }

  if (!routePath) {
    throw new Error('Route path is required. Usage: yamf registry route <path> <service-name>')
  }

  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is required')
  }

  if (options.remove) {
    const headers = {
      [HEADERS.COMMAND]: COMMANDS.ROUTE_UNREGISTER,
      [HEADERS.ROUTE_PATH]: routePath
    }
    if (process.env.YAMF_REGISTRY_TOKEN) {
      headers[HEADERS.REGISTRY_TOKEN] = process.env.YAMF_REGISTRY_TOKEN
    }
    const result = await httpRequest(registryUrl, { headers })
    logger.info(`Route "${routePath}" unregistered`)
    if (options.verbose) console.log(result)
    return
  }

  if (!serviceName) {
    throw new Error('Service name is required for registration. Usage: yamf registry route <path> <service-name>')
  }

  const headers = {
    [HEADERS.COMMAND]: COMMANDS.ROUTE_REGISTER,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.ROUTE_PATH]: routePath,
    [HEADERS.ROUTE_DATATYPE]: options.dataType,
    [HEADERS.ROUTE_TYPE]: options.type
  }
  if (process.env.YAMF_REGISTRY_TOKEN) {
    headers[HEADERS.REGISTRY_TOKEN] = process.env.YAMF_REGISTRY_TOKEN
  }

  const result = await httpRequest(registryUrl, { headers })

  logger.info(`Route "${routePath}" -> service "${serviceName}"`)
  if (options.verbose) console.log(result)
}
