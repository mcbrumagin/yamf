import { httpRequest, COMMANDS, HEADERS, Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { runNodesCommand } from './nodes.js'
import { runListCommand } from './list.js'
import { runHealthCommand } from './health.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  health:  { flags: ['--health'] }
}

function getStatusHelp() {
  return `
yamf status - Get status of yamf environment - health, nodes, and processes

Usage:
  yamf status [options]

Options:
  --health              Focused health view: draining state + active service counts
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
  console.log(`  draining:   ${health.draining ? 'YES — rejecting new registrations' : 'no'}`)
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
  console.log()

  return { health, services }
}

export async function runStatusCommand(args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getStatusHelp())
    return
  }

  if (options.health) {
    return runFocusedHealthStatus(options)
  }

  await runHealthCommand(args)
  await runNodesCommand(args)
  await runListCommand(args)
}
