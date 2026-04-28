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

const BASE_ENV = {
  ...process.env,
  YAMF_REGISTRY_URL: '',
  YAMF_HOME: join(__dirname, '..', '.yamf-cli-registry-nodes-health'),
  LOG_LEVEL: 'error',
  MUTE_LOG_GROUP_OUTPUT: 'true',
  MUTE_SUCCESS_CASES: 'true'
}

const ENV_UNREACHABLE = {
  ...BASE_ENV,
  YAMF_REGISTRY_URL: UNREACHABLE_REGISTRY
}

export async function testNodesExitsWhenRegistryUrlMissing () {
  await assertErr(
    () => {
      execSync(`node ${CLI} nodes`, {
        env: BASE_ENV,
        cwd: CLI_CWD,
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe'
      })
    },
    (err) => {
      const msg = (err.stderr || '') + (err.stdout || '') + (err.message || '')
      return msg.includes('YAMF_REGISTRY_URL') && msg.toLowerCase().includes('init')
    }
  )
}

export async function testNodesPrintsErrorWhenRegistryUnreachable () {
  await assertErr(
    () => {
      execSync(`node ${CLI} nodes`, {
        env: ENV_UNREACHABLE,
        cwd: CLI_CWD,
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      })
    },
    (err) => {
      const msg = (err.stderr || '') + (err.stdout || '') + (err.message || '')
      return msg.includes('Could not reach registry') && msg.includes(UNREACHABLE_REGISTRY)
    }
  )
}

export async function testNodesHelpMentionsRegistry () {
  const out = execSync(`node ${CLI} nodes --help`, {
    env: { ...process.env, MUTE_LOG_GROUP_OUTPUT: 'true' },
    cwd: CLI_CWD,
    encoding: 'utf8',
    timeout: 5000
  })
  await assert(out, (o) => o.includes('yamf nodes') && o.includes('registry'))
}

export async function testHealthFailsWhenRegistryUnreachable () {
  await assertErr(
    () => {
      execSync(`node ${CLI} health`, {
        env: ENV_UNREACHABLE,
        cwd: CLI_CWD,
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      })
    },
    (err) => {
      const msg = (err.stderr || '') + (err.stdout || '') + (err.message || '')
      return (err.status != null && err.status !== 0) && /fetch|Failed|ECONNREFUSED|network/i.test(msg)
    }
  )
}

export async function testHealthHelpShown () {
  const out = execSync(`node ${CLI} health --help`, {
    env: { ...process.env, MUTE_LOG_GROUP_OUTPUT: 'true' },
    cwd: CLI_CWD,
    encoding: 'utf8',
    timeout: 5000
  })
  await assert(out, (o) => o.includes('yamf health') && o.includes('health'))
}
