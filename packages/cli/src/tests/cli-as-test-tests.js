/**
 * yamf test --as-test: glob discovery, default/named exports, failure surfacing.
 */
import { assert } from '@yamf/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const CLI_CWD = join(__dirname, '..')

function exec (cmd, env = {}) {
  return execSync(`node ${CLI} ${cmd}`, {
    env: { ...process.env, MUTE_LOG_GROUP_OUTPUT: 'true', LOG_LEVEL: 'error', ...env },
    cwd: CLI_CWD,
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

function execErr (cmd, env = {}) {
  try {
    exec(cmd, env)
    return null
  } catch (e) {
    return e
  }
}

function msg (err) {
  if (!err) return ''
  return String(err.stderr || '') + String(err.stdout || '') + String(err.message || '')
}

export async function testAsTestRequiresPatternValue () {
  const err = execErr('test --as-test')
  await assert(msg(err), m => m.includes('requires a value'))
}

export async function testAsTestRejectsWhitespaceOnlyPattern () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-ws-'))
  try {
    writeFileSync(join(dir, 'x.example.js'), 'export default async function run () {}\n')
    const err = execErr(`test --as-test "   " -d ${dir}`)
    await assert(msg(err), m => m.includes('non-empty pattern'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestGlobDoesNotMatchStreamingExampleSuffix () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-glob-'))
  try {
    writeFileSync(join(dir, 'good.example.js'), 'export default async function run () {}\n')
    writeFileSync(
      join(dir, 'media-streaming-example.js'),
      'export default async function run () { throw new Error("should not load") }\n'
    )
    const out = exec(`test --as-test '*.example.js' -d ${dir} --list`)
    await assert(out.includes('good.example.js'), x => x === true)
    await assert(!out.includes('media-streaming-example.js'), x => x === true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestRunsDefaultExport () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-def-'))
  const marker = join(dir, 'ran.txt')
  try {
    writeFileSync(
      join(dir, 'touch.example.js'),
      `import { writeFileSync } from 'node:fs'
const marker = ${JSON.stringify(marker)}
export const name = 'touch-smoke'
export default async function run () {
  writeFileSync(marker, 'ok')
}
`
    )
    exec(`test --as-test '*.example.js' -d ${dir}`)
    await assert(readFileSync(marker, 'utf8'), s => s === 'ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestNamedExportWhenNoDefault () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-named-'))
  const marker = join(dir, 'named.txt')
  try {
    writeFileSync(
      join(dir, 'named-only.example.js'),
      `import { writeFileSync } from 'node:fs'
const marker = ${JSON.stringify(marker)}
export async function testNamedSmoke () {
  writeFileSync(marker, 'named')
}
`
    )
    exec(`test --as-test '*.example.js' -d ${dir}`)
    await assert(readFileSync(marker, 'utf8'), s => s === 'named')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestFailureSurfaces () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-fail-'))
  try {
    writeFileSync(
      join(dir, 'boom.example.js'),
      `export default async function run () { throw new Error('boom-example') }\n`
    )
    const err = execErr(`test --as-test '*.example.js' -d ${dir}`)
    await assert(err != null && err.status !== 0, x => x === true)
    const out = msg(err)
    await assert(
      out.includes('boom-example') || out.includes('boom.example') || /✘.*boom/i.test(out),
      x => x === true
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
