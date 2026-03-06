import fs from 'node:fs/promises'
import { httpRequest, Logger, buildAuthLoginHeaders } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  verbose:   { flags: ['-v', '--verbose'] },
  config:    { flags: ['-c', '--config'], type: 'string' },
  user:      { flags: ['-u', '--user'], type: 'string' },
  password:  { flags: ['-p', '--password'], type: 'string' }
}

function getAuthHelp() {
  return `
yamf request - Make an HTTP request to a registered route

Usage:
  yamf request <path> [options]

Config format:
YAMF_USER=<username>
YAMF_PASS=<password>

Options:
  -c, --config            Use a config file (recommended)
  -u, --user              User name
  -p, --password          Password
  -v, --verbose           Verbose output
  -h, --help              Show this help

Examples:
  yamf auth -c <config file>
`
}

export async function runAuthCommand(args) {
  const options = parseArgs(args, ARGS)
  const path = options._positional[0]

  if (options.help) {
    console.log(getAuthHelp())
    return
  }

  let user, password
  if (options.config) {
    // TODO test this config
    let config = await fs.readFile(options.config, 'utf-8')
    let match = config.match(/^YAMF_USER(.+)$/)
    user = match[1]
    match = config.match(/^YAMF_PASS(.+)$/)
    password = match[1]
  }

  user = user || options.user
  password = password || options.password

  let body = null
  if (options.payload) {
    try {
      body = JSON.parse(options.payload)
    } catch {
      body = options.payload
    }
  }

  const method = body && options.method === 'GET' ? 'POST' : options.method

  console.log({user, password})
  const result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
    headers: { ...buildAuthLoginHeaders() },
    body: {
      authenticate: {
        user,
        password
      }
    },
  })
  
  logger.info(result)
}
