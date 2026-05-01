/**
 * Rolling CLI command tests — `yamf restart --rolling`, `yamf registry drain`, `yamf status --health`.
 * Uses the same journey pattern as cli-journey.js (isolated YAMF_HOME + registry port).
 */

import { assert, assertErr } from '@yamf/test'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'

import { envTruthy } from '@yamf/core'
import { runBootstrapWithEnv } from '../lib/bootstrap-for-tests.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const EXAMPLES = join(__dirname, '..', 'example')
const CLI_CWD = join(__dirname, '..')
const DEBUG = envTruthy(process.env.YAMF_TEST_DEBUG)

// Tighter than production defaults: this suite is integration-heavy; keeps exec timeouts sane.
// Production remains unchanged; override here for faster feedback when tuning PM3/registry polling.
let ENV = null

function reserveRegistryBaseUrl () {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close((err) => (err != null ? reject(err) : resolve(`http://127.0.0.1:${port}`)))
    })
    s.on('error', reject)
  })
}

async function resetEnv () {
  cleanup()
  const registryBaseUrl = await reserveRegistryBaseUrl()
  const yamfHome = mkdtempSync(join(tmpdir(), 'yamf-cli-rolling-'))
  ENV = {
    ...process.env,
    YAMF_REGISTRY_URL: registryBaseUrl,
    YAMF_HOME: yamfHome,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    YAMF_GRACEFUL_SHUTDOWN_MS: '2000',
    YAMF_PM3_STOP_GRACE_MS: '5000',
    YAMF_PM3_POLL_INTERVAL_MS: '80',
    YAMF_PM3_POLL_STABLE_CHECKS: '2',
    YAMF_PM3_BROADCAST_SETTLE_MS: '400',
    YAMF_PM3_REGISTRY_CHECK_ATTEMPTS: '6',
    YAMF_PM3_REGISTRY_CHECK_MS: '50',
    // Force keys onto `ENV` so runBootstrapWithEnv strips them from process.env (delete alone
    // omits the key so the shell value would still be inherited by PM3-spawned dev-bootstrap).
    YAMF_REGISTRY_TOKEN: undefined,
    YAMF_DEPLOY_TOKEN: undefined
  }
  await runBootstrapWithEnv(ENV)
}

function cli(cmd, { timeout = 20000 } = {}) {
  if (!ENV) throw new Error('test ENV not initialized; call resetEnv() before CLI usage')
  if (DEBUG) console.log(`\n> yamf ${cmd}`)
  try {
    const stdout = execSync(`node ${CLI} ${cmd}`, {
      env: ENV,
      cwd: CLI_CWD,
      encoding: 'utf8',
      timeout
    })
    const out = stdout.trim()
    if (DEBUG) console.log(out)
    return out
  } catch (err) {
    const combined = ((err.stdout || '') + '\n' + (err.stderr || '')).trim()
    err.output = combined
    if (DEBUG) console.log('[ERROR]', combined)
    throw err
  }
}

function cliSafe(cmd) {
  try { return cli(cmd) } catch (err) { return err.output || '' }
}

function cleanup() {
  if (!ENV) return
  cliSafe('stop --all')
  cliSafe('delete --all')
  if (ENV.YAMF_HOME && existsSync(ENV.YAMF_HOME)) {
    rmSync(ENV.YAMF_HOME, { recursive: true, force: true })
  }
  ENV = null
}

export async function testRestartHelpMentionsRolling() {
  await resetEnv()
  try {
    const out = cli('restart --help')
    assert(out,
      o => o.includes('--rolling'),
      o => o.includes('zero-downtime') || o.includes('zero downtime') || o.includes('Spawn replacement')
    )
  } finally {
    cleanup()
  }
}

export async function testDrainHelpShown() {
  await resetEnv()
  try {
    const out = cli('registry drain --help')
    assert(out,
      o => o.includes('REGISTRY_DRAIN') || o.includes('drain'),
      o => o.includes('YAMF_REGISTRY_URL')
    )
  } finally {
    cleanup()
  }
}

export async function testStatusHelpMentionsHealthFlag() {
  await resetEnv()
  try {
    const out = cli('status --help')
    assert(out, o => o.includes('--health'))
  } finally {
    cleanup()
  }
}

export async function testRestartRollingAndAllMutuallyExclusive() {
  await resetEnv()
  try {
    await assertErr(
      () => cli('restart --rolling --all'),
      err => (err.output || '').includes('cannot be combined')
    )
  } finally {
    cleanup()
  }
}

export async function testDrainRejectsMissingRegistryUrl() {
  await resetEnv()
  try {
    await assertErr(
      () => {
        // Clear registry URL for this invocation only
        execSync(`node ${CLI} registry drain`, {
          env: { ...ENV, YAMF_REGISTRY_URL: '' },
          cwd: CLI_CWD,
          encoding: 'utf8',
          timeout: 5000
        })
      },
      err => {
        const msg = (err.stdout || '') + (err.stderr || '')
        return msg.includes('YAMF_REGISTRY_URL') && msg.includes('not set')
      }
    )
  } finally {
    cleanup()
  }
}

export async function testDrainAgainstLiveRegistry() {
  await resetEnv()
  try {
    const drainOut = cli('registry drain')
    assert(drainOut, o => o.includes('Drain requested'))

    const statusOut = cli('status --health')
    console.log('statusOut', statusOut)
    assert(statusOut,
      o => o.includes('draining:'),
      o => o.includes('YES')
    )
  } finally {
    cleanup()
  }
}

export async function testStatusHealthShowsServiceCounts() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    const out = cli('status --health')
    assert(out,
      o => o.includes('Registry health:'),
      o => o.includes('services:'),
      o => /\d+ name\(s\)/.test(o),
      o => /\d+ instance\(s\)/.test(o)
    )
  } finally {
    cleanup()
  }
}

function readPids(targetFragment = 'load-balanced.js') {
  if (!ENV?.YAMF_HOME) return []
  const statePath = join(ENV.YAMF_HOME, 'pm3', 'state.json')
  if (!existsSync(statePath)) return []
  const raw = JSON.parse(readFileSync(statePath, 'utf8'))
  return Object.values(raw.processes || {})
    .filter(p => p && p.pid && !p.isRegistry && String(p.filepath || '').includes(targetFragment))
    .map(p => p.pid)
    .sort((a, b) => a - b)
}

export async function testRestartRollingReplacesLoadBalancedInstance() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    const pidsBefore = readPids()
    assert(pidsBefore, p => p.length === 1)

    const rollOut = cli(`restart --rolling ${join(EXAMPLES, 'load-balanced.js')}`, { timeout: 45000 })
    assert(rollOut,
      o => o.includes('Rolling-restarted'),
      o => !o.includes('failed to stop old instance')
    )

    const pidsAfter = readPids()
    assert(pidsAfter,
      p => p.length === 1,
      p => p[0] !== pidsBefore[0]
    )

    const listOut = cli('list')
    const loadBalancedLines = listOut.split('\n').filter(l => l.includes('load-balanced.js'))
    assert(listOut,
      o => o.includes('running'),
      o => o.includes('load-balanced')
    )
    assert(loadBalancedLines, l => l.length === 1)
  } finally {
    cleanup()
  }
}

export async function testRestartRollingReplacesMultipleInstances() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)
    cli(`start ${join(EXAMPLES, 'load-balanced.js')} --env YAMF_SERVICE_URL=http://127.0.0.1`)

    const pidsBefore = new Set(readPids())
    assert([...pidsBefore], p => p.length === 2)

    const rollOut = cli(`restart --rolling ${join(EXAMPLES, 'load-balanced.js')}`, { timeout: 60000 })
    assert(rollOut, o => o.includes('Rolling-restarted'))

    const pidsAfter = new Set(readPids())
    assert([...pidsAfter],
      p => p.length === 2,
      p => p.every(pid => !pidsBefore.has(pid))
    )
  } finally {
    cleanup()
  }
}

export async function testRestartRollingRefusesRegistry() {
  await resetEnv()
  try {
    await assertErr(
      () => cli('restart --rolling dev-bootstrap'),
      err => {
        const msg = err.output || ''
        return msg.includes('Rolling restart of the registry is not supported') ||
               msg.includes('No managed process found')
      }
    )
  } finally {
    cleanup()
  }
}
