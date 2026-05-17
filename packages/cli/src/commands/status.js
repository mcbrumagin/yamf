import { httpRequest, COMMANDS, HEADERS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { runNodesCommand } from './nodes.js'
import { runListCommand } from './list.js'
import { runHealthCommand } from './health.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  health:  { flags: ['--health'] },
  versions: { flags: ['--versions'] },
  since:   { flags: ['--since'], type: 'string' }
}

function getStatusHelp() {
  return `
yamf status - Get status of yamf environment - health, nodes, and processes

Usage:
  yamf status [options]

Options:
  --health              Focused health view: draining state + active service counts
                        (also shows recent deploy history from the registry)
  --versions            Show per-replica sourceHash / configVersion (REGISTRY_PULL replicas)
  --since <iso>         With --versions: only show replicas registered on or after <iso>
                        (ISO 8601 date-time, e.g. 2026-04-30T00:00:00Z)
  -v, --verbose         Verbose output
  -h, --help            Show this help
`
}

async function runFocusedHealthStatus(options) {
  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    console.error('YAMF_REGISTRY_URL is not set.')
    process.exit(1)
  }

  let health
  try {
    health = await httpRequest(registryUrl, {
      headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
    })
  } catch (err) {
    console.error(`Could not reach registry at ${registryUrl}: ${err.message}`)
    process.exit(1)
  }

  let registryState = null
  try {
    registryState = await httpRequest(registryUrl, {
      headers: {
        [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
        ...(process.env.YAMF_REGISTRY_TOKEN && { [HEADERS.REGISTRY_TOKEN]: process.env.YAMF_REGISTRY_TOKEN })
      }
    })
  } catch (err) {
    if (options.verbose) {
      logger.warn(`REGISTRY_PULL failed (continuing without service counts): ${err.message}`)
    }
  }

  const services = registryState?.services || {}
  const serviceNames = Object.keys(services)
  const totalInstances = serviceNames.reduce(
    (sum, name) => sum + (Array.isArray(services[name]) ? services[name].length : 0),
    0
  )

  console.log('\nRegistry health:')
  console.log(`  url:        ${registryUrl}`)
  console.log(`  status:     ${health.status}`)
  console.log(`  draining:   ${health.draining ? 'YES - rejecting new registrations' : 'no'}`)
  console.log(`  timestamp:  ${new Date(health.timestamp).toISOString()}`)
  console.log(`  services:   ${serviceNames.length} name(s), ${totalInstances} instance(s)`)

  if (options.verbose && serviceNames.length) {
    console.log()
    for (const name of serviceNames.sort()) {
      const locs = services[name] || []
      console.log(`  - ${name}  (${locs.length} instance${locs.length !== 1 ? 's' : ''})`)
      for (const loc of locs) {
        console.log(`      ${loc}`)
      }
    }
  }

  const deployEvents = Array.isArray(health.deployEvents) ? health.deployEvents : []
  if (deployEvents.length > 0) {
    console.log()
    console.log('  recent deploys:')
    for (const ev of deployEvents) {
      const ts = new Date(ev.at).toISOString()
      const from = ev.fromHash ? ev.fromHash.slice(0, 8) : '(none)'
      const to = ev.toHash ? ev.toHash.slice(0, 8) : '?'
      const by = ev.deployer ? `  deployer=${ev.deployer}` : ''
      console.log(`    ${ts}  ${ev.service}  ${from} -> ${to}  [${ev.decision}]${by}`)
    }
  }

  console.log()

  return { health, services }
}

async function runVersionsStatus (options) {
  const sinceMs = options.since ? Date.parse(options.since) : null
  if (options.since && Number.isNaN(sinceMs)) {
    console.error(`--since: invalid date "${options.since}" (use ISO 8601, e.g. 2026-04-30T00:00:00Z)`)
    process.exit(1)
    return
  }

  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    console.error('YAMF_REGISTRY_URL is not set.')
    process.exit(1)
    return
  }
  const registryState = await httpRequest(registryUrl, {
    headers: {
      [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
      ...(process.env.YAMF_REGISTRY_TOKEN && { [HEADERS.REGISTRY_TOKEN]: process.env.YAMF_REGISTRY_TOKEN })
    }
  })
  const rep = registryState.replicas || {}

  const names = Object.keys(rep).sort()
  if (!names.length) {
    console.log('No per-replica metadata (replicas block empty or legacy services).')
    return
  }
  console.log(`\nReplica versions:${sinceMs != null ? `  (since ${new Date(sinceMs).toISOString()})` : ''}`)
  let shown = 0
  for (const n of names) {
    for (const row of rep[n]) {
      if (sinceMs != null && (row.registeredAt == null || row.registeredAt < sinceMs)) continue
      const nid = row.nodeId ?? row.node
      const bits = [row.sourceHash, row.configVersion, nid && `nodeId=${nid}`].filter(Boolean).join('  ')
      console.log(`  ${n}  @ ${row.location}${bits ? '  ' + bits : ''}`)
      shown++
    }
  }
  if (shown === 0 && sinceMs != null) {
    console.log('  (no replicas registered since the given timestamp)')
  }
  if (options.verbose) {
    console.log()
    console.log(JSON.stringify(rep, null, 2))
  }
  console.log()
}

export async function runStatusCommand(args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getStatusHelp())
    return
  }

  if (options.versions) {
    return runVersionsStatus(options)
  }

  if (options.health) {
    return runFocusedHealthStatus(options)
  }

  await runHealthCommand(args)
  await runNodesCommand(args)
  await runListCommand(args)
}
