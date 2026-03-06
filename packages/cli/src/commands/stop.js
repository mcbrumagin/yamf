import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  all:     { flags: ['--all'] }
}

function getStopHelp() {
  return `
yamf stop - Stop a running script via pm3

Usage:
  yamf stop <filename|service-name> [options]
  yamf stop --all

Accepts a filepath, service name, or instance ref (e.g. simple-service#1).

Options:
  --all                 Stop all managed processes
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

  if (options.all) {
    await pm3.stopAll()
    logger.info('All processes stopped.')
    return
  }

  if (!target) {
    throw new Error('Filename or service name is required. Usage: yamf stop <target> or yamf stop --all')
  }

  const result = await pm3.stop(target)
  if (options.verbose) {
    console.log(result)
  }
}
