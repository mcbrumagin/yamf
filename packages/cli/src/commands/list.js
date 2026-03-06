import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  all:       { flags: ['-a', '--all'] },
  verbose:   { flags: ['-v', '--verbose'] },
  services:  { flags: ['-s', '--services'] },
  locations: { flags: ['-l', '--locations'] }
}

// TODO list --routes
function getListHelp() {
  return `
yamf list - List managed processes, services, or locations

Usage:
  yamf list [options]

Views:
  (default)             Show processes with their services
  -s, --services        Group by service name across all processes
  -l, --locations       Group by host/location

Options:
  -a, --all             Include stopped and internal processes
  -v, --verbose         Show log file paths
  -h, --help            Show this help
`
}

export async function runListCommand(args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getListHelp())
    return
  }

  const pm3 = new PM3()
  const entries = await pm3.list({ all: options.all })

  let view = 'processes'
  if (options.services) view = 'services'
  if (options.locations) view = 'locations'

  console.log(pm3.formatList(entries, { view }))

  if (options.verbose) {
    for (const entry of entries) {
      if (entry.logFile) {
        console.log(`  ${entry.filepath} -> ${entry.logFile}`)
      }
    }
  }
}
