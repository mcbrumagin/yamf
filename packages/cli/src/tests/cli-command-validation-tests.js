/**
 * CLI subcommand smokes: help, validation errors, cheap PM3 success paths.
 * Full journeys (local dev stack, deploy harness) stay in `cli-journey.js` / `cli-build-deploy-tests.js`.
 */
import { assert } from '@yamf/test'
import { envTruthy } from '@yamf/core'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const CLI_CWD = join(__dirname, '..')
const DEBUG = envTruthy(process.env.YAMF_TEST_DEBUG)

function exec (cmd, env = {}) {
  if (DEBUG) console.log(`\n> (cwd=${CLI_CWD}) yamf ${cmd}`)
  const out = execSync(`node ${CLI} ${cmd}`, {
    env: { ...process.env, ...env },
    cwd: CLI_CWD,
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (DEBUG && out) console.log(out)
  return out
}

function execErr (cmd, env = {}) {
  try {
    exec(cmd, env)
    return null
  } catch (e) {
    if (DEBUG) {
      const combined = (e.stderr || '') + (e.stdout || '') + (e.message || '')
      console.log('[ERROR]', combined)
    }
    return e
  }
}

function msg (err) {
  if (!err) return ''
  return (err.stderr || '') + (err.stdout || '') + (err.message || '')
}

// --- Help (fast, no PM3 state) ---

export async function testDeployHelpMentionsLocalRemote () {
  const out = exec('deploy --help')
  await assert(out, (o) => o.includes('--local') && o.includes('--remote'))
}

export async function testStartHelpMentionsReplicas () {
  const out = exec('start --help')
  await assert(out, (o) => o.includes('yamf start') && o.includes('--replicas'))
}

export async function testStopHelpMentionsAll () {
  const out = exec('stop --help')
  await assert(out, (o) => o.includes('--all') && o.includes('yamf stop'))
}

export async function testDeleteHelpMentionsAll () {
  const out = exec('delete --help')
  await assert(out, (o) => o.includes('--all') && o.includes('yamf delete'))
}

export async function testDescribeHelpMentionsRemote () {
  const out = exec('describe --help')
  await assert(out, (o) => o.includes('--remote') && o.includes('yamf describe'))
}

export async function testInitHelpMentionsScaffold () {
  const out = exec('init --help')
  await assert(out, (o) => o.includes('yamf.config.js') && o.includes('yamf init'))
}

export async function testInitWritesManifestInEmptyDir () {
  const d = mkdtempSync(join(__dirname, '..', '.yamf-init-smoke-'))
  try {
    execSync(`node ${CLI} init`, { cwd: d, encoding: 'utf8' })
    await assert(existsSync(join(d, 'yamf.config.js')), (x) => x === true)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

// --- Validation / expected errors ---

export async function testDeployRequiresLocalOrRemote () {
  const err = execErr('deploy my-svc')
  await assert(msg(err), (m) => m.includes('local') && m.includes('remote'))
}

export async function testDeployRequiresServiceNameWithLocal () {
  const err = execErr('deploy --local')
  await assert(msg(err), (m) => m.includes('Service name') || m.includes('service'))
}

export async function testStartRequiresFilename () {
  const err = execErr('start')
  await assert(msg(err), (m) => m.includes('Filename') || m.includes('required'))
}

export async function testStartRejectsUnknownServiceNameWithCleanPm3 () {
  const home = mkdtempSync(join(__dirname, '..', '.yamf-cli-cmdval-'))
  try {
    const err = execErr('start unknown-service-xyz', { YAMF_HOME: home })
    await assert(msg(err), (m) => m.includes('unknown-service') || m.includes('filepath') || m.includes('Cannot start'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

export async function testStopRequiresTargetOrAll () {
  const err = execErr('stop')
  await assert(msg(err), (m) => m.includes('required') || m.includes('Usage') || m.includes('all'))
}

export async function testDeleteRequiresTargetOrAll () {
  const err = execErr('delete')
  await assert(msg(err), (m) => m.includes('required') || m.includes('Usage') || m.includes('all'))
}

export async function testDescribeRequiresTarget () {
  const err = execErr('describe')
  await assert(msg(err), (m) => m.includes('Target') || m.includes('required'))
}

// --- Cheap success (empty PM3 state) ---

export async function testStopAllSucceedsWithEmptyState () {
  const home = mkdtempSync(join(__dirname, '..', '.yamf-cli-cmdval-'))
  try {
    exec('stop --all', { YAMF_HOME: home })
    await assert(true, (x) => x)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

export async function testDeleteAllSucceedsWithEmptyState () {
  const home = mkdtempSync(join(__dirname, '..', '.yamf-cli-cmdval-'))
  try {
    exec('delete --all', { YAMF_HOME: home })
    await assert(true, (x) => x)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// --- `yamf test` guard rails (exit 2) ---

export async function testTestGenerateRequiresAsTest () {
  const err = execErr('test --generate -d . -f "*.js"', { YAMF_LOG_QUIET_GROUPS: 'true' })
  await assert(err && err.status, (s) => s === 2)
  await assert(msg(err), (m) => m.includes('--generate requires --as-test'))
}

export async function testTestAsTestRequiresFileGlob () {
  const err = execErr('test --as-test -d .', { YAMF_LOG_QUIET_GROUPS: 'true' })
  await assert(err && err.status, (s) => s === 2)
  await assert(msg(err), (m) => m.includes('--as-test requires'))
}

export async function testTestInvalidTimeoutRejected () {
  const err = execErr('test -d . --timeout 0', { YAMF_LOG_QUIET_GROUPS: 'true' })
  await assert(err && err.status, (s) => s === 2)
  await assert(msg(err), (m) => m.includes('--timeout'))
}

export async function testTestListAsTestPrintsMatches () {
  const dir = mkdtempSync(join(tmpdir(), 'yamf-cli-testlist-'))
  try {
    writeFileSync(join(dir, 'demo.example.js'), 'console.log(1)\n', 'utf8')
    const out = exec(`test --list --as-test -d ${dir} -f "*.example.js"`, { YAMF_LOG_QUIET_GROUPS: 'true' })
    await assert(out, (o) => o.includes('demo.example.js') && o.includes('Found'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
