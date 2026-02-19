#!/usr/bin/env node

/**
 * yamf - Command-line interface for yamf
 *
 * Usage:
 *   yamf test [options]   Run tests (requires @yamf/test)
 *   yamf <command>        Other subcommands (future)
 */

const subcommand = process.argv[2]
const subcommandArgs = process.argv.slice(3)

async function main() {
  if (!subcommand) {
    console.error('Usage: yamf <command> [options]')
    console.error('')
    console.error('Commands:')
    console.error('  test    Run tests (requires @yamf/test)')
    console.error('')
    console.error('Run "yamf test --help" for test options.')
    process.exit(1)
  }

  switch (subcommand) {
    case 'test': {
      const { runTestCommand } = await import('./commands/test.js')
      await runTestCommand(subcommandArgs)
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

Commands:
  test    Run tests (requires @yamf/test)

Options:
  --help, -h    Show this help
  --version, -v Show version
`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
