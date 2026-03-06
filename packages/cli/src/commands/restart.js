import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  all:     { flags: ['--all'] }
}

function getRestartHelp() {
  return `
yamf restart - Restart managed process(es) via pm3

Usage:
  yamf restart <filename|service-name> [options]
  yamf restart --all

Accepts a filepath, service name, or instance ref (e.g. simple-service#1).

Options:
  --all                 Restart all managed processes
  -v, --verbose         Verbose output
  -h, --help            Show this help
`
}

export async function runRestartCommand(args) {
  const options = parseArgs(args, ARGS)
  const target = options._positional[0]

  if (options.help) {
    console.log(getRestartHelp())
    return
  }

  const pm3 = new PM3()

  if (options.all) {
    const entries = await pm3.list({ all: true })
    for (const entry of entries) {
      if (entry.status === 'running') {
        try { await pm3.restart(entry.filepath) } catch { /* best effort */ }
      }
    }
    logger.info('All processes restarted.')
    return
  }

  if (!target) {
    throw new Error('Filename or service name is required. Usage: yamf restart <target> or yamf restart --all')
  }

  const result = await pm3.restart(target)
  if (options.verbose) {
    console.log(result)
  }
}
