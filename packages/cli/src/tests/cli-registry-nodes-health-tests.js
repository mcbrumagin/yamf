/**
 * CLI: `yamf nodes` and `yamf health` against registry URL (missing / unreachable / help).
 */
import { assert, assertErr } from '@yamf/test'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const CLI_CWD = join(__dirname, '..')
/** Nothing should listen here — fast connection refused. */
const UNREACHABLE_REGISTRY = 'http://127.0.0.1:59997'
const DEBUG = process.env.YAMF_TEST_DEBUG === '1'

const BASE_ENV = {
  ...process.env,
  YAMF_REGISTRY_URL: '',
  YAMF_HOME: join(__dirname, '..', '.yamf-cli-registry-nodes-health'),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  // MUTE_LOG_GROUP_OUTPUT: 'true',
  MUTE_SUCCESS_CASES: 'true'
}

const ENV_UNREACHABLE = {
  ...BASE_ENV,
  YAMF_REGISTRY_URL: UNREACHABLE_REGISTRY
}

function runCli (cmd, env) {
  if (DEBUG) console.log(`\n> (cwd=${CLI_CWD}) yamf ${cmd}`)
  const out = execSync(`node ${CLI} ${cmd}`, {
    env,
    cwd: CLI_CWD,
    encoding: 'utf8',
    timeout: 10000,
    stdio: 'pipe'
  })
  if (DEBUG && out) console.log(out)
  return out
}

export async function testNodesExitsWhenRegistryUrlMissing () {
  await assertErr(
    () => {
      runCli('nodes', BASE_ENV)
    },
    (err) => {
      const msg = (err.stderr || '') + (err.stdout || '') + (err.message || '')
      if (DEBUG) console.log('[ERROR]', msg)
      return msg.includes('YAMF_REGISTRY_URL') && msg.toLowerCase().includes('init')
    }
  )
}

export async function testNodesPrintsErrorWhenRegistryUnreachable () {
  await assertErr(
    () => {
      runCli('nodes', ENV_UNREACHABLE)
    },
    (err) => {
      const msg = (err.stderr || '') + (err.stdout || '') + (err.message || '')
      if (DEBUG) console.log('[ERROR]', msg)
      return msg.includes('Could not reach registry') && msg.includes(UNREACHABLE_REGISTRY)
    }
  )
}

export async function testNodesHelpMentionsRegistry () {
  const out = runCli('nodes --help', { ...process.env, MUTE_LOG_GROUP_OUTPUT: 'true' })
  await assert(out, (o) => o.includes('yamf nodes') && o.includes('registry'))
}

export async function testHealthFailsWhenRegistryUnreachable () {
  await assertErr(
    () => {
      runCli('health', ENV_UNREACHABLE)
    },
    (err) => {
      const msg = (err.stderr || '') + (err.stdout || '') + (err.message || '')
      if (DEBUG) console.log('[ERROR]', msg)
      return (err.status != null && err.status !== 0) && /fetch|Failed|ECONNREFUSED|network/i.test(msg)
    }
  )
}

export async function testHealthHelpShown () {
  const out = runCli('health --help', { ...process.env, MUTE_LOG_GROUP_OUTPUT: 'true' })
  await assert(out, (o) => o.includes('yamf health') && o.includes('health'))
}
