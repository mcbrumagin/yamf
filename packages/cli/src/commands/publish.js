import { publishMessage, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger({ maxDepth: 10 })

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  verbose:   { flags: ['-v', '--verbose'] },
  message:   { flags: ['-m', '--message'], type: 'string' },
  authToken: { flags: ['-a', '--auth'], type: 'string' }
}

function getPublishHelp() {
  return `
yamf publish - Publish a message to a channel

Usage:
  yamf publish <channel> [options]

Options:
  -m, --message <json>    Message to publish (must be valid JSON)
  -a, --auth <token>      Authentication token
  -v, --verbose           Verbose output
  -h, --help              Show this help
`
}

export async function runPublishCommand(args) {
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

  const result = await publishMessage(channel, message, {
    authToken: options.authToken
  })

  logger.info('publish result:', result)
  return result
}
