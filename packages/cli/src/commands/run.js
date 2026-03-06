import { Logger } from '@yamf/core'
import { spawn } from 'node:child_process'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help:    { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] }
}

function getRunHelp() {
  return `
yamf run - Run a script directly with Node

Usage:
  yamf run <filename> [options]

Options:
  -v, --verbose         Verbose output
  -h, --help            Show this help
`
}

export async function runRunCommand(args) {
  const options = parseArgs(args, ARGS)
  const filename = options._positional[0]

  if (options.help) {
    console.log(getRunHelp())
    return
  }

  if (!filename) {
    throw new Error('Filename is required. Usage: yamf run <filename>')
  }

  const child = spawn('node', [filename], { stdio: 'inherit' })

  return new Promise((resolve, reject) => {
    child.on('close', code => {
      if (code !== 0) reject(new Error(`Process exited with code ${code}`))
      else resolve()
    })
  })
}
