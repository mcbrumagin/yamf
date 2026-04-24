#!/usr/bin/env node

/**
 * yamf - Command-line interface for yamf
 *
 * Usage:
 *   yamf init --dev
 *   yamf nodes
 *   yamf call <service> <payload>
 *   yamf publish <channel> <message>
 *   yamf request <path> [options]
 *   yamf route <path> <service-name>
 *   yamf run <filename>
 *   yamf start <filename> [--remote <target>]
 *   yamf stop <filename>
 *   yamf restart <filename>
 *   yamf logs <filename>
 *   yamf list [--all]
 *   yamf delete <filename>
 *   yamf lookup <service-filter>
 *   yamf state <state-property>
 *   yamf test [options]
 */

const subcommand = process.argv[2]
const subcommandArgs = process.argv.slice(3)

async function main() {
  if (!subcommand) {
    printHelp()
    process.exit(1)
  }

  switch (subcommand) {

    // environment commands
    case 'init': {
      const { runInitCommand } = await import('./commands/init.js')
      await runInitCommand(subcommandArgs)
      break
    }
    case 'nodes': {
      const { runNodesCommand } = await import('./commands/nodes.js')
      await runNodesCommand(subcommandArgs)
      break
    }
    case 'status': {
      const { runStatusCommand } = await import('./commands/status.js')
      await runStatusCommand(subcommandArgs)
      break
    }


    // api commands
    case 'call': {
      const { runCallCommand } = await import('./commands/call.js')
      await runCallCommand(subcommandArgs)
      break
    }
    case 'publish': {
      const { runPublishCommand } = await import('./commands/publish.js')
      await runPublishCommand(subcommandArgs)
      break
    }
    case 'request': {
      const { runRequestCommand } = await import('./commands/request.js')
      await runRequestCommand(subcommandArgs)
      break
    }
    case 'auth': {
      const { runAuthCommand } = await import('./commands/auth.js')
      await runAuthCommand(subcommandArgs)
      break
    }


    // registry commands
    case 'health': {
      const { runHealthCommand } = await import('./commands/health.js')
      await runHealthCommand(subcommandArgs)
      break
    }
    case 'drain': {
      const { runDrainCommand } = await import('./commands/drain.js')
      await runDrainCommand(subcommandArgs)
      break
    }
    case 'route': {
      const { runRouteCommand } = await import('./commands/route.js')
      await runRouteCommand(subcommandArgs)
      break
    }
    case 'lookup': {
      const { runLookupCommand } = await import('./commands/lookup.js')
      await runLookupCommand(subcommandArgs)
      break
    }
    case 'state': {
      const { runStateCommand } = await import('./commands/state.js')
      await runStateCommand(subcommandArgs)
      break
    }


    // node wrapper commands
    case 'run': {
      const { runRunCommand } = await import('./commands/run.js')
      await runRunCommand(subcommandArgs)
      break
    }


    // pm3 process management commands
    case 'start': {
      const { runStartCommand } = await import('./commands/start.js')
      await runStartCommand(subcommandArgs)
      break
    }
    case 'list': {
      const { runListCommand } = await import('./commands/list.js')
      await runListCommand(subcommandArgs)
      break
    }
    case 'logs': {
      const { runLogsCommand } = await import('./commands/logs.js')
      await runLogsCommand(subcommandArgs)
      break
    }
    case 'restart': {
      const { runRestartCommand } = await import('./commands/restart.js')
      await runRestartCommand(subcommandArgs)
      break
    }
    case 'stop': {
      const { runStopCommand } = await import('./commands/stop.js')
      await runStopCommand(subcommandArgs)
      break
    }
    case 'delete': {
      const { runDeleteCommand } = await import('./commands/delete.js')
      await runDeleteCommand(subcommandArgs)
      break
    }


    case 'test': {
      const { runTestCommand } = await import('./commands/test.js')
      await runTestCommand(subcommandArgs)
      break
    }
    case 'build': {
      const { runBuildCommand } = await import('./commands/build.js')
      await runBuildCommand(subcommandArgs)
      break
    }
    case 'deploy': {
      const { runDeployCommand } = await import('./commands/deploy.js')
      await runDeployCommand(subcommandArgs)
      break
    }
    case 'config': {
      const { runConfigCommand } = await import('./commands/config.js')
      await runConfigCommand(subcommandArgs)
      break
    }
    case '--help':
    case '-h':
      printHelp()
      break
    case '--version':
    case '-v': {
      const { readFileSync } = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      const { dirname, join } = await import('node:path')
      const __dirname = dirname(fileURLToPath(import.meta.url))
      const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
      console.log(pkg.version ?? '0.1.0')
      break
    }
    default:
      console.error(`Unknown command: ${subcommand}`)
      console.error('Run "yamf --help" for usage.')
      process.exit(1)
  }
}

function printHelp() {
  console.log(`
yamf - Command-line interface for yamf

Usage:
  yamf <command> [options]

Environment:
  init --dev          Start local dev environment (registry + cache + pm3-service)
  nodes               List known service host nodes
  status              Get status of yamf environment - health, nodes, and processes

API:
  call <service>      Call a service with a payload
  publish <channel>   Publish a message to a channel
  request <path>      Make an HTTP request to a registered route

Registry:
  health              Get health of yamf environment
  drain               Ask the registry to drain (reject new registrations)
  route <path> <svc>  Register a route (--remove to unregister)
  lookup <filter>     Look up services, routes, or channels
  state <property>    Get registry state

Process Management (pm3):
  start <filename>    Start a script as a managed process (-i N for instances)
  stop <filename>     Stop managed process(es)
  restart <filename>  Restart managed process(es)
  list                List processes (--services, --locations, --all)
  logs <filename>     View logs for a managed process
  delete <filename>   Stop and remove from process list

Utilities:
  run <filename>      Run a script directly with Node
  test                Run tests (requires @yamf/test)

Deploy (Phase 2):
  build [name]        Bundle services with esbuild into .yamf/build/ (needs yamf.config.js)
  deploy --local SVC   Plan/apply a local deploy (YAMF_SOURCE_HASH + pm3)
  config get|set|list  Control config-service (optional; for deploy env overlay)

Options:
  --help, -h          Show this help
  --version, -v       Show version
`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
