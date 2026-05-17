import { publishMessage, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { resolveCliRegistryToken } from '../lib/resolve-cli-auth.js'

const logger = new Logger({ maxDepth: 10 })

const ARGS = {
  help: { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  message: { flags: ['-m', '--message'], type: 'string' },
  auth: { flags: ['--auth'], type: 'string' },
  token: { flags: ['--token'], type: 'string' }
}

function getPublishHelp () {
  return `
yamf publish - Publish a message to a channel

Usage:
  yamf publish <channel> [options]

Options:
  -m, --message <json>    Message to publish (must be valid JSON)
  --auth user:pass        Log in via the auth service; use token for this publish
  --token <bearer>        Bearer token as yamf-auth-token
  -v, --verbose           Verbose output
  -h, --help              Show this help
`
}

export async function runPublishCommand (args) {
  const options = parseArgs(args, ARGS)
  const channel = options._positional[0]

  if (options.help) {
    console.log(getPublishHelp())
    return
  }

  if (!channel) {
    throw new Error('Channel name is required. Usage: yamf publish <channel> [options]')
  }

  let message = options.message || '{}'
  try {
    message = JSON.parse(message)
  } catch {
    throw new Error('Message must be valid JSON')
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

  const result = await publishMessage(channel, message, { authToken })

  logger.info('publish result:', result)
  return result
}
