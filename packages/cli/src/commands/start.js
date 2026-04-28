import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'
import { createRemotePm3Cli, requireRegistryUrlForRemote } from '../lib/remote-pm3-adapter.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  verbose:   { flags: ['-v', '--verbose'] },
  remote:    { flags: ['-r', '--remote'] },
  env:       { flags: ['-e', '--env'], type: 'string' },
  instances: { flags: ['-i', '--instances'], type: 'number', default: 1 }
}

function getStartHelp() {
  return `
yamf start - Start a script via pm3

Usage:
  yamf start <filename|service-name> [options]

If a service name is given instead of a filepath, the CLI will look up
the filepath from an existing process entry and re-start it.
New services require a filepath.

Options:
  -i, --instances <N>    Start N instances of the script (default: 1)
  -r, --remote            Start on the node reached via YAMF_REGISTRY_URL → pm3-service
  -e, --env <KEY=VALUE>  Set environment variable for child process(es)
  -v, --verbose          Verbose output
  -h, --help             Show this help

Examples:
  yamf start ./my-service.js
  yamf start ./my-service.js --instances 4
  yamf start simple-service
  yamf start /var/lib/yamf/svc.mjs --remote
  yamf start ./my-service.js --env YAMF_SERVICE_URL=http://127.0.0.1
`
}

function looksLikeFilepath(target) {
  return target.includes('/') || target.includes('\\') || target.endsWith('.js')
}

export async function runStartCommand(args) {
  const options = parseArgs(args, ARGS)
  let filename = options._positional[0]

  if (options.help) {
    console.log(getStartHelp())
    return
  }

  if (!filename) {
    throw new Error('Filename is required. Usage: yamf start <filename> [options]')
  }

  if (options.remote) {
    const registryUrl = requireRegistryUrlForRemote()
    if (!looksLikeFilepath(filename)) {
      throw new Error(
        'Remote start requires a filepath on the target host. Use: yamf list --remote, then pass that exact path.'
      )
    }
    const remote = createRemotePm3Cli({ registryUrl })
    let env
    if (options.env) {
      const eqIndex = options.env.indexOf('=')
      if (eqIndex === -1) throw new Error('--env expects KEY=VALUE format')
      env = { [options.env.slice(0, eqIndex)]: options.env.slice(eqIndex + 1) }
    }
    const count = Math.max(1, Math.floor(options.instances))
    for (let i = 0; i < count; i++) {
      const result = await remote.startFile(filename, env ? { env } : undefined)
      if (options.verbose) {
        console.log(result)
      } else {
        logger.info('Remote start:', result)
      }
    }
    return
  }

  const pm3 = new PM3()

  if (!looksLikeFilepath(filename)) {
    const resolvedPath = pm3.filepathForService(filename)
    if (resolvedPath) {
      logger.info(`Resolved service "${filename}" -> ${resolvedPath}`)
      filename = resolvedPath
    } else {
      logger.warn(`No existing service named "${filename}" found. New services require a filepath.`)
      throw new Error(`Cannot start "${filename}" — provide a filepath for new services`)
    }
  }

  let env
  if (options.env) {
    const eqIndex = options.env.indexOf('=')
    if (eqIndex === -1) throw new Error('--env expects KEY=VALUE format')
    env = { [options.env.slice(0, eqIndex)]: options.env.slice(eqIndex + 1) }
  }

  const count = Math.max(1, Math.floor(options.instances))

  for (let i = 0; i < count; i++) {
    const result = await pm3.start(filename, { env })
    if (options.verbose) console.log(result)
  }
}
