import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'
import { createRemotePm3Cli, requireRegistryUrlForRemote } from '../lib/remote-pm3-adapter.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  all:     { flags: ['--all'] },
  remote:  { flags: ['-r', '--remote'] }
}

function getStopHelp() {
  return `
yamf stop - Stop a running script via pm3

Usage:
  yamf stop <filename|service-name> [options]
  yamf stop --all

Accepts a filepath, service name, or instance ref (e.g. simple-service#1).

Options:
  --all                 Stop all managed processes (not supported with --remote)
  -r, --remote          Stop on the node reached via YAMF_REGISTRY_URL (use path from yamf list --remote)
  -v, --verbose         Verbose output
  -h, --help            Show this help
`
}

export async function runStopCommand(args) {
  const options = parseArgs(args, ARGS)
  const target = options._positional[0]

  if (options.help) {
    console.log(getStopHelp())
    return
  }

  const pm3 = new PM3()

  if (options.remote && options.all) {
    throw new Error('--all with --remote is not supported. Stop each path explicitly.')
  }
  if (options.all) {
    await pm3.stopAll()
    logger.info('All processes stopped.')
    return
  }

  if (options.remote) {
    const registryUrl = requireRegistryUrlForRemote()
    if (!target) {
      throw new Error('A filepath (on the remote host) is required. See: yamf list --remote')
    }
    const remote = createRemotePm3Cli({ registryUrl })
    const result = await remote.stop(target)
    if (options.verbose) {
      console.log(result)
    } else {
      logger.info('Remote stop:', result)
    }
    return
  }

  if (!target) {
    throw new Error('Filename or service name is required. Usage: yamf stop <target> or yamf stop --all')
  }

  for (const line of await pm3.getPureServiceStopWarnings(target)) {
    logger.warn(line)
  }

  const result = await pm3.stop(target)
  if (options.verbose) {
    console.log(result)
  }
}
