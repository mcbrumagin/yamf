/**
 * Rolling CLI command tests — `yamf restart --rolling`, `yamf drain`, `yamf status --health`.
 * Uses the same journey pattern as cli-journey.js (isolated YAMF_HOME + registry port).
 */

import { assert, assertErr } from '@yamf/test'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, rmSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const EXAMPLES = join(__dirname, '..', 'example')
const YAMF_HOME = join(__dirname, '..', '.yamf-rolling-commands')
const CLI_CWD = join(__dirname, '..')
const DEBUG = process.env.YAMF_TEST_DEBUG === '1'

// Tighter than production defaults: this suite is integration-heavy; keeps exec timeouts sane.
// Production remains unchanged; override here for faster feedback when tuning PM3/registry polling.
const ENV = {
  ...process.env,
  YAMF_REGISTRY_URL: 'http://localhost:18011',
  YAMF_HOME,
  LOG_LEVEL: 'info',
  MUTE_LOG_GROUP_OUTPUT: 'true',
  YAMF_GRACEFUL_SHUTDOWN_MS: '2000',
  YAMF_PM3_STOP_GRACE_MS: '5000',
  YAMF_PM3_POLL_INTERVAL_MS: '80',
  YAMF_PM3_POLL_STABLE_CHECKS: '2'
}

function cli(cmd, { timeout = 20000 } = {}) {
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
  cliSafe('stop --all')
  cliSafe('delete --all')
  if (existsSync(YAMF_HOME)) {
    rmSync(YAMF_HOME, { recursive: true, force: true })
  }
}

export async function testRestartHelpMentionsRolling() {
  const out = cli('restart --help')
  assert(out,
    o => o.includes('--rolling'),
    o => o.includes('zero-downtime') || o.includes('zero downtime') || o.includes('Spawn replacement')
  )
}

export async function testDrainHelpShown() {
  const out = cli('drain --help')
  assert(out,
    o => o.includes('REGISTRY_DRAIN') || o.includes('drain'),
    o => o.includes('YAMF_REGISTRY_URL')
  )
}

export async function testStatusHelpMentionsHealthFlag() {
  const out = cli('status --help')
  assert(out, o => o.includes('--health'))
}

export async function testRestartRollingAndAllMutuallyExclusive() {
  await assertErr(
    () => cli('restart --rolling --all'),
    err => (err.output || '').includes('cannot be combined')
  )
}

export async function testDrainRejectsMissingRegistryUrl() {
  await assertErr(
    () => {
      // Clear registry URL for this invocation only
      execSync(`node ${CLI} drain`, {
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
}

export async function testDrainAgainstLiveRegistry() {
  cleanup()
  try {
    cli('init --dev')
    const drainOut = cli('drain')
    assert(drainOut, o => o.includes('Drain requested'))

    const statusOut = cli('status --health')
    assert(statusOut,
      o => o.includes('draining:'),
      o => o.includes('YES')
    )
  } finally {
    cleanup()
  }
}

export async function testStatusHealthShowsServiceCounts() {
  cleanup()
  try {
    cli('init --dev')
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

function readPids() {
  const statePath = join(YAMF_HOME, 'pm3', 'state.json')
  if (!existsSync(statePath)) return []
  const raw = JSON.parse(readFileSync(statePath, 'utf8'))
  return Object.values(raw.processes || {})
    .filter(p => p && p.pid && !p.isRegistry)
    .map(p => p.pid)
    .sort((a, b) => a - b)
}

export async function testRestartRollingReplacesLoadBalancedInstance() {
  cleanup()
  try {
    cli('init --dev')
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
  cleanup()
  try {
    cli('init --dev')
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
  cleanup()
  try {
    cli('init --dev')
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
