/**
 * Child-process orchestrator for `yamf test --as-test` and generated suite files.
 * @see yamf/docs/V1-HARDENING.md
 */

import { spawn } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist', 'build', '.yamf', 'tmp'])

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globBasenameToRegex (pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      out += '.*'
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  return new RegExp('^' + out + '$')
}

/**
 * @param {string} rootDir
 * @param {string} basenameGlob  -f value (basename glob)
 * @returns {string[]} absolute paths, sorted
 */
export function discoverAsTestFiles (rootDir, basenameGlob) {
  const dir = path.resolve(rootDir)
  const rx = globBasenameToRegex(basenameGlob)
  const results = []

  function walk (currentDir) {
    let entries
    try {
      entries = readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        if (rx.test(entry.name)) results.push(fullPath)
      }
    }
  }

  walk(dir)
  return results.sort((a, b) => a.localeCompare(b))
}

/**
 * Find monorepo root (directory containing yamf-monorepo package.json).
 * @param {string} startDir
 */
export function findYamfRepoRoot (startDir) {
  let d = path.resolve(startDir)
  const root = path.parse(d).root
  while (d !== root) {
    const pkg = path.join(d, 'package.json')
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, 'utf8'))
        if (j.name === 'yamf-monorepo') return d
      } catch {
        /* ignore */
      }
    }
    d = path.dirname(d)
  }
  return path.resolve(startDir)
}

/**
 * @returns {Promise<number>}
 */
export function pickFreePort () {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      const port = typeof a === 'object' && a ? a.port : 0
      s.close(() => resolve(port))
    })
  })
}

/**
 * TCP connect to 127.0.0.1:port; resolves true if connection succeeds.
 * @param {number} port
 */
export function probePortOpen (port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => {
      resolve(false)
    })
  })
}

/**
 * Poll every 100ms until port accepts TCP, child exits, or deadline.
 * @returns {{ reason: 'exit', code: number|null, signal: NodeJS.Signals|null } | { reason: 'open' } | { reason: 'deadline' }}
 */
async function raceExitPortOrDeadline (child, port, deadlineMs) {
  let exitCode = /** @type {number|null} */ (null)
  let exitSignal = /** @type {NodeJS.Signals|null} */ (null)
  let settled = false

  const onExit = (code, signal) => {
    if (settled) return
    settled = true
    exitCode = code
    exitSignal = signal
  }
  child.on('exit', onExit)

  try {
    while (Date.now() < deadlineMs) {
      if (settled) {
        return { reason: 'exit', code: exitCode, signal: exitSignal }
      }
      const open = await probePortOpen(port)
      if (open) {
        return { reason: 'open' }
      }
      await delay(100)
    }
    return { reason: 'deadline' }
  } finally {
    child.removeListener('exit', onExit)
  }
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<{ code: number|null, signal: NodeJS.Signals|null }>}
 */
function waitForExit (child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

function appendStderrLines (stderrLines, line) {
  stderrLines.push(line)
  if (stderrLines.length > 60) stderrLines.splice(0, stderrLines.length - 50)
}

/**
 * @param {string} absPath
 * @param {object} opts
 * @param {number} opts.timeoutMs
 * @param {number} opts.settleMs
 * @param {(line: string, stream: 'stdout'|'stderr') => void} [opts.onLine]
 */
export async function runScriptAsTest (absPath, opts) {
  const timeoutMs = opts.timeoutMs
  const settleMs = opts.settleMs
  const onLine = opts.onLine
  const basename = path.basename(absPath)
  const prefix = `[${basename}] `

  const port = await pickFreePort()
  const url = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    YAMF_REGISTRY_URL: url,
    YAMF_AS_TEST: '1',
    YAMF_AS_TEST_TIMEOUT_MS: String(timeoutMs),
    YAMF_AS_TEST_SETTLE_MS: String(settleMs),
    // Cap per-terminable shutdown time so stacked services + registry finish within post-SIGTERM wait.
    ...(process.env.YAMF_GRACEFUL_SHUTDOWN_MS ? {} : { YAMF_GRACEFUL_SHUTDOWN_MS: '4000' })
  }

  /** @type {string[]} */
  const stderrLines = []

  const usePiped = typeof opts.onLine === 'function'
  const absResolved = path.resolve(absPath)
  const child = spawn(process.execPath, [absResolved], {
    env,
    cwd: path.dirname(absResolved),
    stdio: usePiped ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit']
  })

  try {
    await new Promise((resolve, reject) => {
      const onErr = (e) => {
        child.removeListener('spawn', onSpawn)
        reject(e)
      }
      const onSpawn = () => {
        child.removeListener('error', onErr)
        resolve()
      }
      child.once('error', onErr)
      child.once('spawn', onSpawn)
    })
  } catch (e) {
    throw new Error(`as-test ${basename}: spawn failed: ${e.message}`)
  }

  let outBuf = ''
  let errBuf = ''

  const flushLines = (buf, stream, isEnd) => {
    const parts = buf.split(/\r?\n/)
    const complete = isEnd ? parts : parts.slice(0, -1)
    const rest = isEnd ? '' : (parts.length ? parts[parts.length - 1] : '')
    for (const line of complete) {
      if (stream === 'stderr') appendStderrLines(stderrLines, line)
      if (onLine) onLine(prefix + line, stream)
    }
    return rest
  }

  if (usePiped) {
    child.stdout?.on('data', (ch) => {
      outBuf += ch.toString()
      outBuf = flushLines(outBuf, 'stdout', false)
    })
    child.stderr?.on('data', (ch) => {
      errBuf += ch.toString()
      errBuf = flushLines(errBuf, 'stderr', false)
    })
  }

  const deadline = Date.now() + timeoutMs
  const first = await raceExitPortOrDeadline(child, port, deadline)

  const tail = () => {
    if (usePiped) {
      outBuf = flushLines(outBuf, 'stdout', true)
      errBuf = flushLines(errBuf, 'stderr', true)
    }
    return stderrLines.slice(-50).join('\n')
  }

  if (first.reason === 'exit') {
    child.stdout?.removeAllListeners()
    child.stderr?.removeAllListeners()
    const code = first.code
    const sig = first.signal
    if (code === 0 && !sig) return
    const t = tail()
    throw new Error(
      `as-test ${basename}: child exited before registry port opened (code=${code} signal=${sig})\n${t}`
    )
  }

  if (first.reason === 'deadline') {
    child.kill('SIGTERM')
    await delay(1000)
    if (child.exitCode === null && child.signalCode == null) {
      child.kill('SIGKILL')
    }
    await waitForExit(child)
    child.stdout?.removeAllListeners()
    child.stderr?.removeAllListeners()
    throw new Error(
      `as-test ${basename}: timed out waiting for port or exit (no readiness within ${timeoutMs}ms)\n${tail()}`
    )
  }

  // port open
  await delay(settleMs)
  child.kill('SIGTERM')

  // Worst case: each terminable may run up to YAMF_GRACEFUL_SHUTDOWN_MS (sequential cascade).
  const postTermWait = Math.min(180000, Math.max(timeoutMs * 3, 75000))

  await Promise.race([
    waitForExit(child),
    delay(postTermWait)
  ])

  if (child.exitCode === null && child.signalCode == null) {
    child.kill('SIGKILL')
    await waitForExit(child)
    child.stdout?.removeAllListeners()
    child.stderr?.removeAllListeners()
    throw new Error(`as-test ${basename}: child still alive after SIGTERM (escalated SIGKILL)\n${tail()}`)
  }

  const { code, signal } = await waitForExit(child)

  child.stdout?.removeAllListeners()
  child.stderr?.removeAllListeners()

  if (code === 0 && !signal) return
  if (signal === 'SIGTERM') return
  if (signal === 'SIGKILL') {
    throw new Error(`as-test ${basename}: killed after SIGTERM timeout\n${tail()}`)
  }
  throw new Error(`as-test ${basename}: unexpected exit code=${code} signal=${signal}\n${tail()}`)
}

function slugDir (dirArg) {
  if (dirArg === '.' || dirArg === './') return 'repo'
  const abs = path.resolve(dirArg)
  return abs
    .toLowerCase()
    .replace(/[/\\]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'repo'
}

function slugGlob (g) {
  return g
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'glob'
}

/**
 * @param {object} o
 * @param {string} o.repoRoot
 * @param {string} o.dirArg - original -d
 * @param {string} o.fileGlob - original -f
 * @param {string[]} o.matchedAbsPaths sorted
 * @returns {string} file body
 */
export function renderGeneratedAsTestFile ({ repoRoot, dirArg, fileGlob, matchedAbsPaths }) {
  const importPath = '@yamf/cli/internal/as-test-runner'
  const genDir = path.join(repoRoot, '.yamf', 'generated')
  const lines = [
    '// AUTO-GENERATED by `yamf test --as-test --generate`.',
    `// Source: -d ${dirArg} -f ${fileGlob}`,
    '// Regenerate with the same command. Do not edit by hand.',
    '',
    `import { runScriptAsTest } from '${importPath}'`,
    'import { resolve } from \'node:path\'',
    'import { fileURLToPath } from \'node:url\'',
    'import { dirname } from \'node:path\'',
    '',
    'const __filename = fileURLToPath(import.meta.url)',
    'const __dirname = dirname(__filename)',
    '',
    'const TIMEOUT_MS = Number(process.env.YAMF_AS_TEST_TIMEOUT_MS || 30000)',
    'const SETTLE_MS = Number(process.env.YAMF_AS_TEST_SETTLE_MS || 250)',
    ''
  ]

  for (const abs of matchedAbsPaths) {
    const relToGen = path.relative(genDir, abs).split(path.sep).join('/')
    const safeName = path.basename(abs, '.js').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
    const exportName = `test_${safeName || 'case'}`
    lines.push(
      `export async function ${exportName} () {`,
      `  await runScriptAsTest(resolve(__dirname, '${relToGen}'), {`,
      '    timeoutMs: TIMEOUT_MS,',
      '    settleMs: SETTLE_MS',
      '  })',
      '}',
      ''
    )
  }

  return lines.join('\n')
}

/**
 * Default output path under repo root.
 */
export function defaultGenerateOutPath (repoRoot, dirArg, fileGlob) {
  const ds = slugDir(dirArg)
  const gs = slugGlob(fileGlob)
  return path.join(repoRoot, '.yamf', 'generated', `${ds}-${gs}.test.js`)
}

/**
 * @returns {{ path: string, content: string }}
 */
export function buildGeneratePayload (repoRoot, dirArg, fileGlob, matchedAbsPaths, explicitOut) {
  const outPath = explicitOut
    ? path.resolve(explicitOut)
    : defaultGenerateOutPath(repoRoot, dirArg, fileGlob)
  const content = renderGeneratedAsTestFile({
    repoRoot,
    dirArg,
    fileGlob,
    matchedAbsPaths
  })
  return { path: outPath, content }
}

export function writeGenerateFile (outPath, content) {
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, content, 'utf8')
}
