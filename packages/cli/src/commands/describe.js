import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import parseArgs from '../lib/parse-args.js'
import { createRemotePm3Cli, requireRegistryUrlForRemote } from '../lib/remote-pm3-adapter.js'

const logger = new Logger()

const ARGS = {
  help: { flags: ['-h', '--help'] },
  remote: { flags: ['-r', '--remote'] }
}

function getDescribeHelp () {
  return `
yamf describe - Show pm3 state for one managed process (JSON)

Usage:
  yamf describe <filepath|service-ref> [options]

The target is resolved the same way as yamf stop / yamf logs locally. On --remote, pass the
exact filepath (or #N instance ref) from yamf list --remote.

Options:
  -r, --remote   Query the node reached via YAMF_REGISTRY_URL → pm3-service
  -h, --help     Show this help
`
}

export async function runDescribeCommand (args) {
  const options = parseArgs(args, ARGS)
  const target = options._positional[0]

  if (options.help) {
    console.log(getDescribeHelp())
    return
  }
  if (!target) {
    throw new Error('Target is required. Example: yamf describe /path/to/script.mjs')
  }

  if (options.remote) {
    const registryUrl = requireRegistryUrlForRemote()
    const remote = createRemotePm3Cli({ registryUrl })
    const entry = await remote.status(target)
    if (entry == null) {
      logger.warn(`No process on remote for "${target}"`)
      return
    }
    console.log(JSON.stringify(entry, null, 2))
    return
  }

  const pm3 = new PM3()
  const entry = await pm3.status(target)
  if (!entry) {
    logger.warn(`No process found for "${target}"`)
    return
  }
  console.log(JSON.stringify(entry, null, 2))
}
