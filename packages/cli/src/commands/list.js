import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'
import { createRemotePm3Cli, requireRegistryUrlForRemote } from '../lib/remote-pm3-adapter.js'

const logger = new Logger()

const ARGS = {
  help:      { flags: ['-h', '--help'] },
  all:       { flags: ['-a', '--all'] },
  verbose:   { flags: ['-v', '--verbose'] },
  services:  { flags: ['-s', '--services'] },
  locations: { flags: ['-l', '--locations'] },
  remote:    { flags: ['-r', '--remote'] }
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
  -v, --verbose         Show filepath and log file location (for copy-paste to other --remote commands)
  -r, --remote          List processes on the node reached via YAMF_REGISTRY_URL → pm3-service
  -h, --help            Show this help

For remote, filepaths in the "Filepath" column are the paths to pass to yamf stop|restart|logs|delete|describe --remote.
If multiple pm3-service instances are registered, each request may hit a different node. Set
  YAMF_PM3_SERVICE_LOCATION
to a pm3-service base URL (from REGISTRY_PULL or your ops notes) to send all --remote pm3 commands to that
instance via the yamf-prefer-service-location header on SERVICE_CALL.
`
}

export async function runListCommand(args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getListHelp())
    return
  }

  const pm3 = new PM3()

  if (options.remote) {
    const registryUrl = requireRegistryUrlForRemote()
    const remote = createRemotePm3Cli({ registryUrl })
    const entries = await remote.list({ all: options.all })
    let view = 'processes'
    if (options.services) view = 'services'
    if (options.locations) view = 'locations'
    console.log(pm3.formatList(entries, { view }))
    if (options.verbose) {
      for (const entry of entries) {
        if (entry.logFile) {
          console.log(`  ${entry.filepath}  ->  ${entry.logFile}`)
        } else {
          console.log(`  ${entry.filepath}  (no log file)`)
        }
      }
    }
    return
  }

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
