import { callRoute, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  verbose:   { flags: ['-v', '--verbose'] },
  payload:   { flags: ['-p', '--payload'], type: 'string' },
  method:    { flags: ['-m', '--method'], type: 'string', default: 'GET' },
  authToken: { flags: ['-a', '--auth'], type: 'string' }
}

function getRequestHelp() {
  return `
yamf request - Make an HTTP request to a registered route

Usage:
  yamf request <path> [options]

Options:
  -p, --payload <json>    Request body (JSON string, implies POST)
  -m, --method <method>   HTTP method (default: GET, or POST if payload given)
  -a, --auth <token>      Authentication token
  -v, --verbose           Verbose output
  -h, --help              Show this help

Examples:
  yamf request /health
  yamf request /api/users -p '{"name":"Alice"}'
  yamf request /api/users -m DELETE -p '{"id":1}'
`
}

export async function runRequestCommand(args) {
  const options = parseArgs(args, ARGS)
  const path = options._positional[0]

  if (options.help) {
    console.log(getRequestHelp())
    return
  }

  if (!path) {
    throw new Error('Route path is required. Usage: yamf request <path> [options]')
  }

  let body = null
  if (options.payload) {
    try {
      body = JSON.parse(options.payload)
    } catch {
      body = options.payload
    }
  }

  const method = body && options.method === 'GET' ? 'POST' : options.method

  const result = await callRoute(path, {
    method,
    body,
    authToken: options.authToken
  })

  if (options.verbose) {
    logger.info(`${method} ${path} →`, result)
  } else {
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
  }
}
