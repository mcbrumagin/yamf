/**
 * Unit tests for PM3 instance methods that do not require live processes or a registry.
 *
 * Paths exercised:
 *   pollDefaults()            — reads YAMF_PM3_POLL_* env config
 *   shouldUseRegistryBroadcastStop() — defaults true; YAMF_PM3_STOP_REGISTRY_BROADCAST=false disables
 *   getStopSigtermPollMs()    — defaults 100; env override honoured
 *   pruneDeadProcesses()      — marks entries with dead PIDs as stopped; living PIDs stay running
 */
import { assert, withEnv } from '@yamf/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PM3 } from '../lib/pm3.js'
import { envConfig } from '@yamf/core'

// ---------------------------------------------------------------------------
// pollDefaults
// ---------------------------------------------------------------------------

export async function testPm3PollDefaultsReturnsConfig () {
  const pm3 = new PM3()
  const d = pm3.pollDefaults()
  await assert(d, (x) =>
    typeof x.maxAttempts === 'number' &&
    x.maxAttempts > 0 &&
    typeof x.intervalMs === 'number' &&
    typeof x.consecutiveChecksRequired === 'number'
  )
}

export async function testPm3PollDefaultsRespectEnvOverride () {
  const pm3 = new PM3()
  await withEnv({
    YAMF_PM3_POLL_MAX_ATTEMPTS: '7',
    YAMF_PM3_POLL_INTERVAL_MS: '55',
    YAMF_PM3_POLL_STABLE_CHECKS: '2'
  }, async () => {
    const d = pm3.pollDefaults()
    await assert(d,
      (x) => x.maxAttempts === 7,
      (x) => x.intervalMs === 55,
      (x) => x.consecutiveChecksRequired === 2
    )
  })
}

// ---------------------------------------------------------------------------
// shouldUseRegistryBroadcastStop
// ---------------------------------------------------------------------------

export async function testPm3ShouldUseBroadcastDefaultTrue () {
  const pm3 = new PM3()
  const orig = process.env.YAMF_PM3_STOP_REGISTRY_BROADCAST
  delete process.env.YAMF_PM3_STOP_REGISTRY_BROADCAST
  envConfig.reloadFromProcessEnv()
  try {
    const result = pm3.shouldUseRegistryBroadcastStop()
    await assert(result, (x) => x === true)
  } finally {
    if (orig !== undefined) process.env.YAMF_PM3_STOP_REGISTRY_BROADCAST = orig
    else delete process.env.YAMF_PM3_STOP_REGISTRY_BROADCAST
    envConfig.reloadFromProcessEnv()
  }
}

export async function testPm3ShouldUseBroadcastDisabledByEnv () {
  const pm3 = new PM3()
  const orig = process.env.YAMF_PM3_STOP_REGISTRY_BROADCAST
  process.env.YAMF_PM3_STOP_REGISTRY_BROADCAST = 'false'
  envConfig.reloadFromProcessEnv()
  try {
    const result = pm3.shouldUseRegistryBroadcastStop()
    await assert(result, (x) => x === false)
  } finally {
    if (orig !== undefined) process.env.YAMF_PM3_STOP_REGISTRY_BROADCAST = orig
    else delete process.env.YAMF_PM3_STOP_REGISTRY_BROADCAST
    envConfig.reloadFromProcessEnv()
  }
}

// ---------------------------------------------------------------------------
// getStopSigtermPollMs
// ---------------------------------------------------------------------------

export async function testPm3SigtermPollMsDefault () {
  const pm3 = new PM3()
  const orig = process.env.YAMF_PM3_STOP_POLL_MS
  delete process.env.YAMF_PM3_STOP_POLL_MS
  envConfig.reloadFromProcessEnv()
  try {
    const ms = pm3.getStopSigtermPollMs()
    await assert(ms, (x) => x === 100)
  } finally {
    if (orig !== undefined) process.env.YAMF_PM3_STOP_POLL_MS = orig
    else delete process.env.YAMF_PM3_STOP_POLL_MS
    envConfig.reloadFromProcessEnv()
  }
}

export async function testPm3SigtermPollMsEnvOverride () {
  const pm3 = new PM3()
  const orig = process.env.YAMF_PM3_STOP_POLL_MS
  process.env.YAMF_PM3_STOP_POLL_MS = '50'
  envConfig.reloadFromProcessEnv()
  try {
    const ms = pm3.getStopSigtermPollMs()
    await assert(ms, (x) => x === 50)
  } finally {
    if (orig !== undefined) process.env.YAMF_PM3_STOP_POLL_MS = orig
    else delete process.env.YAMF_PM3_STOP_POLL_MS
    envConfig.reloadFromProcessEnv()
  }
}

export async function testPm3SigtermPollMsTooSmallIgnored () {
  const pm3 = new PM3()
  const orig = process.env.YAMF_PM3_STOP_POLL_MS
  process.env.YAMF_PM3_STOP_POLL_MS = '5'
  envConfig.reloadFromProcessEnv()
  try {
    // 5 < 10 -> fallback to default 100
    const ms = pm3.getStopSigtermPollMs()
    await assert(ms, (x) => x === 100)
  } finally {
    if (orig !== undefined) process.env.YAMF_PM3_STOP_POLL_MS = orig
    else delete process.env.YAMF_PM3_STOP_POLL_MS
    envConfig.reloadFromProcessEnv()
  }
}

// ---------------------------------------------------------------------------
// pruneDeadProcesses - uses a temp YAMF_HOME directory
// ---------------------------------------------------------------------------

const DEAD_PID = 999999

function makeTmpHome (label) {
  const dir = join(tmpdir(), `yamf-pm3-unit-${label}-${Date.now()}`)
  const pm3Dir = join(dir, 'pm3')
  mkdirSync(pm3Dir, { recursive: true })
  return { home: dir, pm3Dir }
}

function writeState (pm3Dir, state) {
  writeFileSync(join(pm3Dir, 'state.json'), JSON.stringify(state, null, 2))
}

export async function testPm3PruneMarkDeadPidAsStopped () {
  const { home, pm3Dir } = makeTmpHome('prune-dead')
  const state = {
    processes: {
      '/fake/worker.js': {
        pid: DEAD_PID,
        filepath: '/fake/worker.js',
        status: 'running',
        services: {}
      }
    },
    registryUrl: null,
    startedAt: null
  }
  writeState(pm3Dir, state)

  const orig = process.env.YAMF_HOME
  process.env.YAMF_HOME = home
  try {
    const pm3 = new PM3()
    const result = pm3.pruneDeadProcesses()
    const entry = result.processes['/fake/worker.js']
    await assert(entry, (e) => e.status === 'stopped' && e.pid === null)
  } finally {
    if (orig !== undefined) process.env.YAMF_HOME = orig
    else delete process.env.YAMF_HOME
  }
}

export async function testPm3PruneKeepsLivePidRunning () {
  const { home, pm3Dir } = makeTmpHome('prune-live')
  // Use current PID - definitely alive.
  const livePid = process.pid
  const state = {
    processes: {
      '/fake/live.js': {
        pid: livePid,
        filepath: '/fake/live.js',
        status: 'running',
        services: {}
      }
    },
    registryUrl: null,
    startedAt: null
  }
  writeState(pm3Dir, state)

  const orig = process.env.YAMF_HOME
  process.env.YAMF_HOME = home
  try {
    const pm3 = new PM3()
    const result = pm3.pruneDeadProcesses()
    const entry = result.processes['/fake/live.js']
    await assert(entry, (e) => e.status === 'running' && e.pid === livePid)
  } finally {
    if (orig !== undefined) process.env.YAMF_HOME = orig
    else delete process.env.YAMF_HOME
  }
}
