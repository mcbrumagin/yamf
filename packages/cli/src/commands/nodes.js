import { httpRequest, HEADERS, COMMANDS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] }
}

function getNodesHelp() {
  return `
yamf nodes - List known service host nodes

Usage:
  yamf nodes [options]

Queries the registry for all service locations and displays unique hostnames.
For local dev, this typically shows "localhost" or "127.0.0.1".

Options:
  -v, --verbose         Show service details per host
  -h, --help            Show this help
`
}

export async function runNodesCommand(args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getNodesHelp())
    return
  }

  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    console.error('YAMF_REGISTRY_URL is not set. Run "yamf init --dev" to start a local registry.')
    process.exit(1)
  }

  let state
  try {
    state = await httpRequest(registryUrl, {
      headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL }
    })
  } catch (err) {
    console.error(`Could not reach registry at ${registryUrl}: ${err.message}`)
    process.exit(1)
  }

  const hostMap = {}
  for (const serviceName in state.services) {
    for (const location of state.services[serviceName]) {
      try {
        const url = new URL(location)
        const host = url.hostname
        if (!hostMap[host]) hostMap[host] = []
        hostMap[host].push({ serviceName, location })
      } catch { /* skip malformed */ }
    }
  }

  const hosts = Object.keys(hostMap)

  if (hosts.length === 0) {
    console.log('No nodes found. Start some services first.')
    return
  }

  console.log(`\nNodes (${hosts.length}):\n`)

  for (const host of hosts) {
    const services = hostMap[host]
    console.log(`  ${host}  (${services.length} service${services.length !== 1 ? 's' : ''})`)
    if (options.verbose) {
      for (const { serviceName, location } of services) {
        console.log(`    - ${serviceName}  ${location}`)
      }
    }
  }

  console.log()
}
