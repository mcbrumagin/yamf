/**
 * CLI `--remote` paths: require `YAMF_REGISTRY_URL` (no live node; pm3-service wire not exercised).
 */
import { assert, assertErr } from '@yamf/test'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const CLI_CWD = join(__dirname, '..')

const BASE_ENV = {
  ...process.env,
  YAMF_REGISTRY_URL: '',
  YAMF_HOME: join(__dirname, '..', '.yamf-cli-remote-registry-smoke'),
  LOG_LEVEL: 'error',
  MUTE_LOG_GROUP_OUTPUT: 'true'
}

export async function testListRemoteRequiresRegistryUrl () {
  await assertErr(
    () => {
      execSync(`node ${CLI} list --remote`, {
        env: BASE_ENV,
        cwd: CLI_CWD,
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe'
      })
    },
    (err) => {
      const msg = (err.stdout || '') + (err.stderr || '') + (err.message || '')
      return msg.includes('YAMF_REGISTRY_URL') && msg.includes('required')
    }
  )
}

export async function testDescribeRemoteRequiresRegistryUrl () {
  await assertErr(
    () => {
      execSync(`node ${CLI} describe foo --remote`, {
        env: BASE_ENV,
        cwd: CLI_CWD,
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe'
      })
    },
    (err) => {
      const msg = (err.stdout || '') + (err.stderr || '') + (err.message || '')
      return msg.includes('YAMF_REGISTRY_URL') && msg.includes('required')
    }
  )
}

export async function testListHelpMentionsRemotePm3Service () {
  const out = execSync(`node ${CLI} list --help`, {
    env: { ...process.env, MUTE_LOG_GROUP_OUTPUT: 'true' },
    cwd: CLI_CWD,
    encoding: 'utf8',
    timeout: 5000
  })
  await assert(out, (o) => o.includes('--remote') && o.includes('pm3-service'))
}
