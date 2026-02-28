import { httpRequest, COMMANDS, HEADERS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { runNodesCommand } from './nodes.js'
import { runListCommand } from './list.js'
import { runHealthCommand } from './health.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  verbose:   { flags: ['-v', '--verbose'] },
}

function getStatusHelp() {
  return `
yamf status - Get status of yamf environment - health, nodes, and processes

Usage:
  yamf status [options]

Options:
  -v, --verbose            Verbose output
  -h, --help               Show this help
`
}

export async function runStatusCommand(args) {
  const options = parseArgs(args, ARGS)
  
  if (options.help) {
    console.log(getStatusHelp())
    return
  }

  await runHealthCommand(args)
  await runNodesCommand(args)
  await runListCommand(args)
}
