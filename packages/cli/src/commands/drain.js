import { httpRequest, HEADERS, COMMANDS, Logger } from '@yamf/core'
import { randomUUID } from 'node:crypto'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] }
}

function getDrainHelp() {
  return `
yamf drain - Ask the tracked registry to enter drain mode

Issues REGISTRY_DRAIN to $YAMF_REGISTRY_URL without killing the registry.
A draining registry rejects new SERVICE_SETUP / SERVICE_REGISTER with 503
while continuing to serve SERVICE_CALL, SERVICE_LOOKUP, SERVICE_UNREGISTER,
REGISTRY_PULL, and HEALTH. Use as a pre-deploy prep step or for inspection.

Usage:
  yamf drain [options]

Environment:
  YAMF_REGISTRY_URL     (required) registry endpoint to drain
  YAMF_REGISTRY_TOKEN   (optional) shared registry auth token

Options:
  -v, --verbose         Print full response body
  -h, --help            Show this help
`
}

export async function runDrainCommand(args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getDrainHelp())
    return
  }

  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is not set. Cannot drain a registry I cannot find.')
  }

  const token = process.env.YAMF_REGISTRY_TOKEN
  const drainerId = randomUUID()

  const headers = {
    'content-type': 'application/json',
    [HEADERS.COMMAND]: COMMANDS.REGISTRY_DRAIN,
    [HEADERS.REGISTRY_INSTANCE_ID]: drainerId
  }
  if (token) headers[HEADERS.REGISTRY_TOKEN] = token

  const result = await httpRequest(registryUrl, {
    method: 'POST',
    body: {},
    headers
  })

  if (options.verbose) {
    console.log(result)
  } else {
    const peerId = result?.instanceId ? ` (registry instance ${result.instanceId})` : ''
    logger.info(`Drain requested at ${registryUrl}${peerId}.`)
  }
  return result
}
