/**
 * CLI subcommand smokes: help, validation errors, cheap PM3 success paths.
 * Full journeys (init --dev, deploy harness) stay in `cli-journey.js` / `cli-build-deploy-tests.js`.
 */
import { assert } from '@yamf/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

function execErr (cmd, env = {}) {
  try {
    execSync(`node ${CLI} ${cmd}`, {
      env: { ...process.env, MUTE_LOG_GROUP_OUTPUT: 'true', LOG_LEVEL: 'error', ...env },
      cwd: CLI_CWD,
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return null
  } catch (e) {
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

export async function testStartHelpMentionsInstances () {
  const out = exec('start --help')
  await assert(out, (o) => o.includes('yamf start') && o.includes('--instances'))
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

export async function testInitHelpMentionsDev () {
  const out = exec('init --help')
  await assert(out, (o) => o.includes('--dev') && o.includes('yamf init'))
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

export async function testInitWithoutDevExitsWithGuidance () {
  const err = execErr('init')
  await assert(err && err.status, (s) => s === 1 || s > 0)
  await assert(msg(err), (m) => m.includes('init') && (m.includes('dev') || m.includes('Usage')))
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
