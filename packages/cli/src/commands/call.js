import { callService, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  verbose:   { flags: ['-v', '--verbose'] },
  payload:   { flags: ['-p', '--payload'], type: 'string' },
  file:      { flags: ['-f', '--file'], type: 'string' },
  dataType:  { flags: ['-d', '--dataType'], type: 'string', default: 'application/json' },
  authToken: { flags: ['-a', '--auth'], type: 'string' }
}

function getCallHelp() {
  return `
yamf call - Call a service

Usage:
  yamf call <service> [options]

Options:
  -p, --payload <json>      Payload to send to the service
  -f, --file <file>         File to send to the service
  -d, --dataType <type>     Content type (default: application/json)
  -a, --auth <token>        Authentication token
  -v, --verbose             Verbose output
  -h, --help                Show this help
`
}

export async function runCallCommand(args) {
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

  if (options.payload && options.dataType === 'application/json') {
    options.payload = JSON.parse(options.payload)
  }

  const result = await callService(service, options.payload, {
    contentType: options.dataType,
    authToken: options.authToken
  })

  logger.info('call service result:', result)
  return result
}
