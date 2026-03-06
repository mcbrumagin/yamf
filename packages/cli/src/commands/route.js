import { httpRequest, HEADERS, COMMANDS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:     { flags: ['-h', '--help'] },
  verbose:  { flags: ['-v', '--verbose'] },
  remove:   { flags: ['-r', '--remove'] },
  dataType: { flags: ['-d', '--dataType'], type: 'string', default: 'application/json' },
  type:     { flags: ['-t', '--type'], type: 'string', default: 'route' }
}

function getRouteHelp() {
  return `
yamf route - Register or unregister a route

Usage:
  yamf route <path> <service-name> [options]   Register a route
  yamf route <path> --remove                   Unregister a route

Options:
  -r, --remove            Unregister the route instead of registering
  -d, --dataType <type>   Content type (default: application/json)
  -t, --type <type>       Route type: "route" (exact) or "controller" (prefix) (default: route)
  -v, --verbose           Verbose output
  -h, --help              Show this help

Examples:
  yamf route /health simple-service
  yamf route /api/users/* user-controller --type controller
  yamf route /health --remove
`
}

export async function runRouteCommand(args) {
  const options = parseArgs(args, ARGS)
  const routePath = options._positional[0]
  const serviceName = options._positional[1]

  if (options.help) {
    console.log(getRouteHelp())
    return
  }

  if (!routePath) {
    throw new Error('Route path is required. Usage: yamf route <path> <service-name>')
  }

  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is required')
  }

  if (options.remove) {
    const result = await httpRequest(registryUrl, {
      headers: {
        [HEADERS.COMMAND]: COMMANDS.ROUTE_UNREGISTER,
        [HEADERS.ROUTE_PATH]: routePath
      }
    })
    logger.info(`Route "${routePath}" unregistered`)
    if (options.verbose) console.log(result)
    return
  }

  if (!serviceName) {
    throw new Error('Service name is required for registration. Usage: yamf route <path> <service-name>')
  }

  const result = await httpRequest(registryUrl, {
    headers: {
      [HEADERS.COMMAND]: COMMANDS.ROUTE_REGISTER,
      [HEADERS.SERVICE_NAME]: serviceName,
      [HEADERS.ROUTE_PATH]: routePath,
      [HEADERS.ROUTE_DATATYPE]: options.dataType,
      [HEADERS.ROUTE_TYPE]: options.type
    }
  })

  logger.info(`Route "${routePath}" → service "${serviceName}"`)
  if (options.verbose) console.log(result)
}
