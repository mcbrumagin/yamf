import childProcess from 'child_process'
import { openSync, closeSync, readFileSync } from 'node:fs'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Spawns a fully detached child process with stdio redirected to a log file.
 * No pipes are used — the child writes directly to the file via OS-level fd,
 * so there's no buffer to fill and no risk of blocking the child's event loop.
 *
 * If `waitFor` is provided, polls the log file for the pattern before resolving.
 * Returns { pid, logFile }.
 */
export async function spawnDetached(command, args, {
  waitFor,
  timeout = 5000,
  logFile,
  dir = process.cwd(),
  env
} = {}) {
  const stdioConfig = ['ignore', 'ignore', 'ignore']
  let fd

  if (logFile) {
    fd = openSync(logFile, 'a')
    stdioConfig[1] = fd
    stdioConfig[2] = fd
  }

  const child = childProcess.spawn(command, args, {
    cwd: dir,
    detached: true,
    stdio: stdioConfig,
    env: env ? { ...process.env, ...env } : undefined
  })

  child.unref()

  // Parent doesn't need the fd — the child inherited its own copy via fork
  if (fd !== undefined) closeSync(fd)

  if (!waitFor || !logFile) {
    return { pid: child.pid, logFile }
  }

  const start = Date.now()
  let lastSize = 0

  while (Date.now() - start < timeout) {
    await sleep(100)
    try {
      const content = readFileSync(logFile, 'utf8')
      if (content.length > lastSize) {
        const newContent = content.slice(lastSize)
        lastSize = content.length
        if (typeof waitFor === 'string' && newContent.includes(waitFor)) {
          return { pid: child.pid, logFile }
        }
        if (waitFor instanceof RegExp && waitFor.test(newContent)) {
          return { pid: child.pid, logFile }
        }
      }
    } catch {
      // log file may not exist yet if the child hasn't written anything
    }
  }

  return { pid: child.pid, logFile }
}
