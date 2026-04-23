import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  all:     { flags: ['--all'] },
  rolling: { flags: ['--rolling'] }
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
  --rolling             Spawn replacement before stopping old instance (zero-downtime for load-balanced services)
  -v, --verbose         Verbose output
  -h, --help            Show this help

Notes:
  --rolling and --all cannot be combined (rolling targets a single known service/filepath).
  --rolling refuses to operate on the registry process locally; k3s drives registry rolling.
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

  if (options.rolling && options.all) {
    throw new Error('--rolling and --all cannot be combined. Use --rolling <target> for a single service/filepath.')
  }

  if (options.all) {
    const entries = await pm3.list({ all: true })
    const toRestart = entries.filter((e) => e.status === 'running')
    let success = 0
    let failed = 0
    for (const entry of toRestart) {
      try {
        await pm3.restart(entry.filepath)
        success++
      } catch {
        failed++
      }
    }
    logger.info(
      `Restarted ${success} of ${toRestart.length} process(es)${failed ? `, ${failed} failed` : ''}.`
    )
    return
  }

  if (!target) {
    throw new Error('Filename or service name is required. Usage: yamf restart <target> or yamf restart --all')
  }

  if (options.rolling) {
    const result = await pm3.restartRolling(target)
    if (options.verbose) {
      console.log(result)
    } else {
      logger.info(`Rolling-restarted ${result.replaced.length} instance(s) of "${target}".`)
    }
    return
  }

  const result = await pm3.restart(target)
  if (options.verbose) {
    console.log(result)
  }
}
