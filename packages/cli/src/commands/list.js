import { Logger, httpRequest, HEADERS, COMMANDS } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import { formatPm3List, formatRegistryPullSection } from '../lib/pm3-format.js'
import parseArgs from '../lib/parse-args.js'
import { createRemotePm3Cli, requireRegistryUrlForRemote } from '../lib/remote-pm3-adapter.js'

const logger = new Logger()

const ARGS = {
  help:         { flags: ['-h', '--help'] },
  all:          { flags: ['-a', '--all'] },
  verbose:      { flags: ['-v', '--verbose'] },
  services:     { flags: ['-s', '--services'] },
  locations:    { flags: ['-l', '--locations'] },
  remote:       { flags: ['-r', '--remote'] },
  liveRegistry: { flags: ['-L', '--live-registry'] }
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
  -L, --live-registry   After the PM3 table, query REGISTRY_PULL at YAMF_REGISTRY_URL and show all
                        registered service names and locations (source of truth; not PM3’s cached
                        per-process list, which is only updated when a process starts and can be
                        empty if the poll missed or a worker died — use -a to see stopped PIDs).
                        Same if YAMF_LIST_LIVE=1 (no flag).
  -r, --remote          List processes on the node reached via YAMF_REGISTRY_URL → pm3-service
  -h, --help            Show this help

For remote, filepaths in the "Filepath" column are the paths to pass to yamf stop|restart|logs|delete|describe --remote.
If multiple pm3-service instances are registered, each request may hit a different node. Set
  YAMF_PM3_SERVICE_LOCATION
to a pm3-service base URL (from REGISTRY_PULL or your ops notes) to send all --remote pm3 commands to that
instance via the yamf-service-prefer-location header on SERVICE_CALL.
`
}

export async function runListCommand(args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getListHelp())
    return
  }

  if (options.remote) {
    const registryUrl = requireRegistryUrlForRemote()
    const remote = createRemotePm3Cli({ registryUrl })
    const entries = await remote.list({ all: options.all })
    let view = 'processes'
    if (options.services) view = 'services'
    if (options.locations) view = 'locations'
    console.log(formatPm3List(entries, { view }))
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

  const pm3 = new PM3()
  const entries = await pm3.list({ all: options.all })

  let view = 'processes'
  if (options.services) view = 'services'
  if (options.locations) view = 'locations'

  console.log(formatPm3List(entries, { view }))

  if (options.verbose) {
    for (const entry of entries) {
      if (entry.logFile) {
        console.log(`  ${entry.filepath} -> ${entry.logFile}`)
      }
    }
  }

  const wantLiveRegistry =
    options.liveRegistry || (!options.remote && process.env.YAMF_LIST_LIVE === '1')

  if (wantLiveRegistry) {
    const u = process.env.YAMF_REGISTRY_URL
    if (!u) {
      process.stderr.write('yamf list (live registry): YAMF_REGISTRY_URL is not set; skipping.\n')
    } else {
      try {
        const token = process.env.YAMF_REGISTRY_TOKEN || ''
        const pull = await httpRequest(u, {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
            ...(token && { [HEADERS.REGISTRY_TOKEN]: token })
          }
        })
        console.log('')
        console.log(formatRegistryPullSection(u, pull))
      } catch (e) {
        process.stderr.write(`yamf list (live registry): ${e?.message || e}\n`)
      }
    }
  }
}
