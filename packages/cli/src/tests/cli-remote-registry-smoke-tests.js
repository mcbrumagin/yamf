/**
 * CLI `--remote` paths: require `YAMF_REGISTRY_URL` (no live node; pm3-service wire not exercised).
 */
import { assert, assertErr } from '@yamf/test'
import { envTruthy } from '@yamf/core'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const CLI_CWD = join(__dirname, '..')
const DEBUG = envTruthy(process.env.YAMF_TEST_DEBUG)

const BASE_ENV = {
  ...process.env,
  YAMF_REGISTRY_URL: '',
  YAMF_HOME: join(__dirname, '..', '.yamf-cli-remote-registry-smoke'),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
}

function runCli (cmd, env = BASE_ENV) {
  if (DEBUG) console.log(`\n> (cwd=${CLI_CWD}) yamf ${cmd}`)
  const out = execSync(`node ${CLI} ${cmd}`, {
    env,
    cwd: CLI_CWD,
    encoding: 'utf8',
    timeout: 5000,
    stdio: 'pipe'
  })
  if (DEBUG && out) console.log(out)
  return out
}

export async function testListRemoteRequiresRegistryUrl () {
  await assertErr(
    () => {
      runCli('list --remote')
    },
    (err) => {
      const msg = (err.stdout || '') + (err.stderr || '') + (err.message || '')
      if (DEBUG) console.log('[ERROR]', msg)
      return msg.includes('YAMF_REGISTRY_URL') && msg.includes('required')
    }
  )
}

export async function testDescribeRemoteRequiresRegistryUrl () {
  await assertErr(
    () => {
      runCli('describe foo --remote')
    },
    (err) => {
      const msg = (err.stdout || '') + (err.stderr || '') + (err.message || '')
      if (DEBUG) console.log('[ERROR]', msg)
      return msg.includes('YAMF_REGISTRY_URL') && msg.includes('required')
    }
  )
}

export async function testListHelpMentionsRemotePm3Service () {
  const out = runCli('list --help', { ...process.env, YAMF_LOG_QUIET_GROUPS: 'true' })
  await assert(out, (o) => o.includes('--remote') && o.includes('pm3'))
}
