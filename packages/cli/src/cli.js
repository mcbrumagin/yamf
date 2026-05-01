#!/usr/bin/env node

/**
 * yamf - Command-line interface for yamf
 *
 * Usage:
 *   yamf init
 *   yamf registry state|lookup|route|drain
 *   yamf nodes
 *   yamf call <service>
 *   yamf publish <channel> <message>
 *   yamf request <path>
 *   yamf start <filename>
 *   yamf test [options]
 */

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {Map<string, (args: string[]) => Promise<void>>} */
const SUBCOMMAND_HANDLERS = new Map([
  ['init', async (args) => (await import('./commands/init.js')).runInitCommand(args)],
  ['nodes', async (args) => (await import('./commands/nodes.js')).runNodesCommand(args)],
  ['status', async (args) => (await import('./commands/status.js')).runStatusCommand(args)],
  ['call', async (args) => (await import('./commands/call.js')).runCallCommand(args)],
  ['publish', async (args) => (await import('./commands/publish.js')).runPublishCommand(args)],
  ['request', async (args) => (await import('./commands/request.js')).runRequestCommand(args)],
  ['health', async (args) => (await import('./commands/health.js')).runHealthCommand(args)],
  ['registry', async (args) => (await import('./commands/registry.js')).runRegistryCommand(args)],
  ['gateway', async (args) => (await import('./commands/gateway.js')).runGatewayCommand(args)],
  ['run', async (args) => (await import('./commands/run.js')).runRunCommand(args)],
  ['start', async (args) => (await import('./commands/start.js')).runStartCommand(args)],
  ['list', async (args) => (await import('./commands/list.js')).runListCommand(args)],
  ['describe', async (args) => (await import('./commands/describe.js')).runDescribeCommand(args)],
  ['logs', async (args) => (await import('./commands/logs.js')).runLogsCommand(args)],
  ['restart', async (args) => (await import('./commands/restart.js')).runRestartCommand(args)],
  ['stop', async (args) => (await import('./commands/stop.js')).runStopCommand(args)],
  ['delete', async (args) => (await import('./commands/delete.js')).runDeleteCommand(args)],
  ['clean', async (args) => (await import('./commands/clean.js')).runCleanCommand(args)],
  ['test', async (args) => (await import('./commands/test.js')).runTestCommand(args)],
  ['build', async (args) => (await import('./commands/build.js')).runBuildCommand(args)],
  ['deploy', async (args) => (await import('./commands/deploy.js')).runDeployCommand(args)],
  ['dev', async (args) => (await import('./commands/dev.js')).runDevCommand(args)],
  ['config', async (args) => (await import('./commands/config.js')).runConfigCommand(args)]
])

function printHelp () {
  console.log(`
yamf - Command-line interface for yamf

Usage:
  yamf <command> [options]

Top-level flags:
  -h, --help          Show this help
  --version           Print CLI version
  -v                  Same as --version at the top level only (subcommands use -v for --verbose)

Environment:
  init                  Write yamf.config.js from the template (use yamf dev for local stack)
  nodes                 List known service host nodes
  status                Environment status — health, nodes, processes

API:
  call <service>        Call a service with a payload
  publish <channel>     Publish a message to a channel
  request <path>        HTTP request to a registered route

Registry:
  health                Registry / environment health
  registry state        Registry pull / state
  registry lookup       Service lookup
  registry route        Register or unregister routes
  registry drain        Drain mode (reject new registrations)

Gateway:
  gateway               Stub; see help for planned surface

Process management (pm3):
  start <filename>      Start a script (-i / --replicas for multiple local processes)
  stop <filename>       Stop managed process(es)
  restart <filename>    Restart managed process(es)
  list                  List processes (--services, --locations, --all, --remote)
  describe <target>     JSON state for one process
  logs <filename>       View logs for a managed process
  delete <filename>     Stop and remove from process list
  clean                 Stop all and remove .yamf/

Utilities:
  run <filename>        Run a script with Node
  test                  Run @yamf/test suites (see yamf test --help)

Deploy:
  build [name]          Bundle services into .yamf/build/
  deploy --local|…      Plan/apply deploy
  dev [name|entry.js]   Watch and redeploy
  config get|set|list   Config-service overlay
`)
}

/**
 * Dispatch the yamf CLI from a synthetic argv (e.g. process.argv or ['node','yamf','list']).
 * @param {string[]} argv
 */
export async function dispatchYamfCli (argv) {
  const subcommand = argv[2]
  const subcommandArgs = argv.slice(3)

  if (!subcommand) {
    printHelp()
    process.exit(1)
    return
  }

  if (subcommand === '--help' || subcommand === '-h') {
    printHelp()
    return
  }

  if (subcommand === '--version' || subcommand === '-v') {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    console.log(pkg.version ?? '0.1.0')
    return
  }

  const handler = SUBCOMMAND_HANDLERS.get(subcommand)
  if (!handler) {
    const err = new Error(`Unknown command: ${subcommand}\nRun "yamf --help" for usage.`)
    err.code = 'YAMF_CLI_UNKNOWN'
    throw err
  }

  await handler(subcommandArgs)
}

async function main () {
  await dispatchYamfCli(process.argv)
}

/**
 * True when this file was invoked as the program entry (not merely imported).
 * Compare real paths: global bins are often symlinks (e.g. /usr/local/bin/yamf → …/cli.js)
 * while import.meta.url points at the target file, so plain resolve() never matched.
 */
function isCliEntryModule () {
  const entry = process.argv[1]
  if (entry == null || entry === '') return false
  const here = realpathSync(fileURLToPath(import.meta.url))
  try {
    return realpathSync(resolve(entry)) === here
  } catch {
    return false
  }
}

const isCliEntry = isCliEntryModule()

if (isCliEntry) {
  main().catch((err) => {
    console.error(err.message || err)
    process.exit(1)
  })
}
