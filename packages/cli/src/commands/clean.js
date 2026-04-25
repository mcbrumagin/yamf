import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'

const logger = new Logger()

const ARGS = {
  help: { flags: ['-h', '--help'] }
}

function getCleanHelp () {
  return `
yamf clean - Stop all pm3 processes and remove the yamf home directory

Runs the same stop and state cleanup as \`yamf delete --all\`, then deletes the yamf home
tree (default: .yamf in the current working directory, or \$YAMF_HOME when set), including
pm3 state, logs, and .yamf/build/ bundles.

Usage:
  yamf clean

Options:
  -h, --help    Show this help
`
}

/**
 * @param {string[]} args
 */
export async function runCleanCommand (args) {
  const options = parseArgs(args, ARGS)
  if (options.help) {
    console.log(getCleanHelp())
    return
  }
  if (options._positional?.length) {
    throw new Error('yamf clean takes no arguments. See: yamf clean --help')
  }

  const pm3 = new PM3()
  await pm3.stopAll()
  await pm3.deleteAll()
  logger.info('All processes stopped and removed from pm3 state.')

  const yamfHome = process.env.YAMF_HOME
    ? process.env.YAMF_HOME
    : join(process.cwd(), '.yamf')
  if (!existsSync(yamfHome)) {
    logger.info(`No yamf home directory to remove (${yamfHome})`)
    return
  }
  await rm(yamfHome, { recursive: true, force: true })
  logger.info(`Removed ${yamfHome}`)
}
