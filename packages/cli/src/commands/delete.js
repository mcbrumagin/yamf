import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  all:     { flags: ['--all'] }
}

function getDeleteHelp() {
  return `
yamf delete - Stop and remove process(es) from pm3

Usage:
  yamf delete <filename|service-name> [options]
  yamf delete --all

Accepts a filepath, service name, or instance ref (e.g. simple-service#1).

Options:
  --all                 Delete all managed processes
  -v, --verbose         Verbose output
  -h, --help            Show this help
`
}

export async function runDeleteCommand(args) {
  const options = parseArgs(args, ARGS)
  const target = options._positional[0]

  if (options.help) {
    console.log(getDeleteHelp())
    return
  }

  const pm3 = new PM3()

  if (options.all) {
    await pm3.stopAll()
    await pm3.deleteAll()
    logger.info('All processes deleted.')
    return
  }

  if (!target) {
    throw new Error('Filename or service name is required. Usage: yamf delete <target> or yamf delete --all')
  }

  await pm3.delete(target)
}
