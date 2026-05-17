/**
 * yamf test --as-test: orchestrator, discovery, generate, timeout (see docs §9).
 */
import { assert, assertErr } from '@yamf/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { envTruthy } from '@yamf/core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const CLI_CWD = join(__dirname, '..')
/** Monorepo root (directory containing `packages/`). */
const ROOT = join(__dirname, '..', '..', '..', '..')
const DEBUG = envTruthy(process.env.YAMF_TEST_DEBUG)

function exec (cmd, env = {}) {
  if (DEBUG) {
    console.log(`\n> (cwd=${CLI_CWD}) yamf ${cmd}`)
  }
  const out = execSync(`node ${CLI} ${cmd}`, {
    env: { ...process.env, LOG_LEVEL: process.env.LOG_LEVEL || 'info', ...env },
    cwd: CLI_CWD,
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (DEBUG && out) {
    console.log(out)
  }
  return out
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

function ensureEsm (dir) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }) + '\n')
}

export async function testAsTestRequiresFileFlag () {
  const err = execErr('test --as-test')
  await assert(msg(err), m => m.includes('-f') || m.includes('file'))
}

export async function testAsTestNoMatchesFails () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-empty-'))
  try {
    const err = execErr(`test --as-test -f "*.no-such-pattern.js" -d ${dir}`)
    await assertErr(err, e => e.status === 1 || e.status !== 0)
    await assert(msg(err), m => m.includes('No files matched') || m.includes('no files matched'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestRunsOneScriptToCleanExit () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-quick-'))
  try {
    writeFileSync(
      join(dir, 'quick.example.js'),
      'console.log("ready")\n'
    )
    exec(`test --as-test -f "*.example.js" -d ${dir}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestSignalsShutdownToYamfRegistry () {
  const coreDir = join(ROOT, 'packages', 'core')
  exec(`test --as-test -f "kernel-basic.example.js" -d ${coreDir}`)
}

export async function testAsTestFailsOnPreShutdownThrow () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-throw-'))
  try {
    writeFileSync(join(dir, 'bad.example.js'), 'throw new Error("boom-top")\n')
    const err = execErr(`test --as-test -f "*.example.js" -d ${dir}`)
    await assertErr(err, e => e.status !== 0)
    await assert(msg(err), m => m.includes('boom-top') || m.includes('as-test'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestEnforcesTimeout () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-hang-'))
  try {
    ensureEsm(dir)
    writeFileSync(
      join(dir, 'hang.example.js'),
      'await new Promise(() => {})\n'
    )
    const err = execErr(`test --as-test -f "*.example.js" -d ${dir} --timeout 3000`)
    await assertErr(err, e => e.status !== 0)
    await assert(msg(err), m => m.includes('timed out') || m.includes('no readiness') || m.includes('as-test'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestRunsCasesSequentiallyInPathOrder () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-order-'))
  const orderFile = join(dir, 'order.txt')
  try {
    ensureEsm(dir)
    writeFileSync(
      join(dir, 'a.example.js'),
      `import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(orderFile)}, 'a')
`
    )
    writeFileSync(
      join(dir, 'b.example.js'),
      `import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(orderFile)}, 'b')
`
    )
    exec(`test --as-test -f "*.example.js" -d ${dir}`)
    const out = readFileSync(orderFile, 'utf8')
    await assert(out, o => o === 'ab')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestUsesUniqueRegistryUrlPerCase () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-url-'))
  const portsFile = join(dir, 'ports.txt')
  try {
    ensureEsm(dir)
    const body = `import { appendFileSync } from 'node:fs'
const port = new URL(process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:0').port
appendFileSync(${JSON.stringify(portsFile)}, port + '\\n')
`
    writeFileSync(join(dir, 'one.example.js'), body)
    writeFileSync(join(dir, 'two.example.js'), body)
    exec(`test --as-test -f "*.example.js" -d ${dir}`)
    const lines = readFileSync(portsFile, 'utf8').trim().split('\n').filter(Boolean)
    await assert(lines, arr => arr.length === 2 && arr[0] !== arr[1])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testAsTestExposesYamfAsTestEnv () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-env-'))
  try {
    ensureEsm(dir)
    writeFileSync(
      join(dir, 'env.example.js'),
      `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(join(dir, 'env.out'))}, process.env.YAMF_AS_TEST || '')
`
    )
    exec(`test --as-test -f "*.example.js" -d ${dir}`)
    await assert(readFileSync(join(dir, 'env.out'), 'utf8'), s => s === 'true')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testGenerateRequiresAsTest () {
  const err = execErr('test --generate -f "*.example.js"')
  await assert(msg(err), m => m.includes('--generate requires') || m.includes('as-test'))
}

export async function testGenerateWritesDeterministicFile () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-gen-'))
  try {
    writeFileSync(join(dir, 'x.example.js'), 'console.log(1)\n')
    const out = join(dir, 'out.test.js')
    const cmd = `test --as-test -d ${dir} -f "*.example.js" --generate --generate-out ${out}`
    exec(cmd)
    const a = readFileSync(out, 'utf8')
    exec(cmd)
    const b = readFileSync(out, 'utf8')
    await assert([a, b], ([x, y]) => x === y)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testGenerateOutPathRespected () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-genout-'))
  const custom = join(dir, 'custom-suite.test.js')
  try {
    writeFileSync(join(dir, 'z.example.js'), 'console.log(1)\n')
    exec(`test --as-test -d ${dir} -f "*.example.js" --generate --generate-out ${custom}`)
    await assert(readFileSync(custom, 'utf8'), c => c.includes('runScriptAsTest'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testTimeoutAppliesToNormalTests () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-normto-'))
  try {
    ensureEsm(dir)
    writeFileSync(
      join(dir, 'slow-tests.js'),
      `import { sleep } from '@yamf/test'
export async function testSlowForever () {
  await sleep(60000)
}
`
    )
    const err = execErr(`test -d ${dir} -f slow-tests.js --timeout 300`, {
      NODE_PATH: join(ROOT, 'node_modules')
    })
    await assertErr(err, e => e.status !== 0)
    await assert(msg(err), m => /timed out|Timeout|timeout/i.test(m))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testTimeoutAppliesToAsTestCases () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-att-'))
  try {
    ensureEsm(dir)
    writeFileSync(join(dir, 'hang.example.js'), 'await new Promise(() => {})\n')
    const err = execErr(`test --as-test -f "*.example.js" -d ${dir} --timeout 2500`)
    await assertErr(err, e => e.status !== 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testGlobDotIsLiteral () {
  const dir = mkdtempSync(join(tmpdir(), 'as-test-globdot-'))
  try {
    writeFileSync(join(dir, 'good.example.js'), 'console.log("ok")\n')
    writeFileSync(
      join(dir, 'media-streaming-example.js'),
      'throw new Error("must not run")\n'
    )
    exec(`test --as-test -f "*.example.js" -d ${dir}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
