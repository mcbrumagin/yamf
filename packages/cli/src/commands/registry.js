function printRegistryHelp () {
  console.log(`
yamf registry - Registry operations (state, lookup, routes, drain)

Usage:
  yamf registry <subcommand> [options]

Subcommands:
  state <property?>   Registry pull / state (optional property filter)
  lookup <search>     Service lookup
  route               Register or unregister routes (see yamf registry route --help)
  drain               Request registry drain mode

Examples:
  yamf registry state
  yamf registry lookup my-service
  yamf registry route /health my-svc
  yamf registry drain

Run yamf registry <subcommand> --help for subcommand options.
`)
}

export async function runRegistryCommand (args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printRegistryHelp()
    if (args.length === 0) process.exit(1)
    return
  }

  const sub = args[0]
  const rest = args.slice(1)

  switch (sub) {
    case 'state': {
      const { runStateCommand } = await import('./state.js')
      await runStateCommand(rest)
      break
    }
    case 'lookup': {
      const { runLookupCommand } = await import('./lookup.js')
      await runLookupCommand(rest)
      break
    }
    case 'route': {
      const { runRouteCommand } = await import('./route.js')
      await runRouteCommand(rest)
      break
    }
    case 'drain': {
      const { runDrainCommand } = await import('./drain.js')
      await runDrainCommand(rest)
      break
    }
    default:
      console.error(`Unknown registry subcommand: ${sub}`)
      console.error('Run "yamf registry --help" for usage.')
      process.exit(1)
  }
}
