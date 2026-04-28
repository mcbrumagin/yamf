import { Logger } from '@yamf/core'
import { PM3 } from '../lib/pm3.js'
import { watchFile, unwatchFile, statSync, openSync, readSync, closeSync } from 'node:fs'
import { basename, relative } from 'node:path'
import parseArgs from '../lib/parse-args.js'
import { createRemotePm3Cli, requireRegistryUrlForRemote } from '../lib/remote-pm3-adapter.js'

const logger = new Logger()

const ARGS = {
  help:  { flags: ['-h', '--help'] },
  lines: { flags: ['-n', '--lines'], type: 'number', default: 50 },
  all:   { flags: ['--all'] },
  watch: { flags: ['-w', '--watch'] },
  list:  { flags: ['-l', '--list'] },
  remote: { flags: ['-r', '--remote'] }
}

function getLogsHelp() {
  return `
yamf logs - Get logs for a managed script

Usage:
  yamf logs <filename|service-name> [options]
  yamf logs --list

Options:
  -l, --list            List log file locations
  -n, --lines <num>     Number of lines to show (default: 50)
  --all                 Show all log lines
  -w, --watch           Watch for new log output (live tail; not available with --remote)
  -r, --remote          Read logs from the node via YAMF_REGISTRY_URL (path from yamf list --remote)
  -h, --help            Show this help
`
}

export async function runLogsCommand(args) {
  const options = parseArgs(args, ARGS)
  const filename = options._positional[0]

  if (options.help) {
    console.log(getLogsHelp())
    return
  }

  const pm3 = new PM3()

  if (options.remote) {
    if (options.list) {
      throw new Error('Use `yamf list --remote -v` to see filepaths and log paths on the remote node.')
    }
    if (options.watch) {
      throw new Error('--watch is not supported with --remote.')
    }
    const registryUrl = requireRegistryUrlForRemote()
    if (!filename) {
      throw new Error('A filepath on the remote host is required. Usage: yamf logs <path> --remote')
    }
    const remote = createRemotePm3Cli({ registryUrl })
    const output = await remote.logs(filename, { lines: options.all ? 0 : options.lines })
    if (output) console.log(output)
    return
  }

  if (options.list) {
    const files = pm3.logFiles({ all: options.all })
    if (files.length === 0) {
      console.log('No log files.')
      return
    }
    const cwd = process.cwd()
    for (const f of files) {
      const label = basename(f.filepath, '.js') + (f.stateKey.includes('#') ? '#' + f.stateKey.split('#').pop() : '')
      const logRel = f.logFile ? relative(cwd, f.logFile) : '(none)'
      console.log(`${label}  ->  ${logRel}`)
    }
    return
  }

  if (!filename) {
    throw new Error('Filename or service name is required. Usage: yamf logs <target>')
  }

  const output = await pm3.logs(filename, { lines: options.all ? 0 : options.lines })
  if (output) console.log(output)

  if (options.watch) {
    const entry = await pm3.status(filename)
    if (!entry?.logFile) {
      logger.warn('No log file to watch')
      return
    }

    let lastSize = 0
    try {
      lastSize = statSync(entry.logFile).size
    } catch { /* file might not exist yet */ }

    console.log('\n--- watching (Ctrl+C to stop) ---\n')

    watchFile(entry.logFile, { interval: 300 }, (curr) => {
      if (curr.size <= lastSize) return
      try {
        const fd = openSync(entry.logFile, 'r')
        const buf = Buffer.alloc(curr.size - lastSize)
        readSync(fd, buf, 0, buf.length, lastSize)
        closeSync(fd)
        process.stdout.write(buf.toString())
        lastSize = curr.size
      } catch { /* ignore read errors during watch */ }
    })

    process.on('SIGINT', () => {
      unwatchFile(entry.logFile)
      process.exit(0)
    })

    await new Promise(() => {})
  }
}
