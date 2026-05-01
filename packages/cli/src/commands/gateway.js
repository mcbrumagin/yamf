function printGatewayHelp () {
  console.log(`
yamf gateway - Gateway CLI (stub)

Gateway-focused subcommands are planned for a later release. For now use:

  yamf request <path>     HTTP to a registered route
  yamf registry …         Registry state, lookup, routes, drain

There are no operational gateway subcommands yet.
`)
}

export async function runGatewayCommand (args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printGatewayHelp()
    if (args.length === 0) process.exit(1)
    return
  }

  console.error(`Unknown gateway subcommand: ${args[0]}`)
  console.error('Run "yamf gateway --help" for usage.')
  process.exit(1)
}
