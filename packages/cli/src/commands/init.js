import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import parseArgs from '../lib/parse-args.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXAMPLE_CONFIG = join(__dirname, '..', '..', '..', '..', 'yamf.config.example.js')

const ARGS = {
  help: { flags: ['-h', '--help'] },
  force: { flags: ['--force'] }
}

function getInitHelp () {
  return `
yamf init - Create yamf.config.js from the repo template (manifest scaffolding only)

Usage:
  yamf init [options]

For a local registry, cache, and pm3-service, run:

  yamf dev

Options:
  --force           Overwrite an existing yamf.config.js
  -h, --help        Show this help
`
}

export async function runInitCommand (args) {
  const options = parseArgs(args, ARGS)

  if (options.help) {
    console.log(getInitHelp())
    return
  }

  const target = join(process.cwd(), 'yamf.config.js')
  if (existsSync(target) && !options.force) {
    console.log('yamf.config.js already exists (use --force to overwrite).')
    return
  }

  const template = readFileSync(EXAMPLE_CONFIG, 'utf8')
  writeFileSync(target, template, 'utf8')
  console.log(`Wrote ${target}`)
}
