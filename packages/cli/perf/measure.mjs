#!/usr/bin/env node
/**
 * Ad-hoc CLI timing helper for PM3 / yamf (see perf/CLI-PERF-PLAN.md).
 */
import { execSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const cliDir = fileURLToPath(new URL('..', import.meta.url))
const yamfBin = join(cliDir, 'src/cli.js')
const yamfRepoRoot = join(cliDir, '..', '..')

const FIXED_SCENARIOS = ['list', 'state', 'stopAll']

function gitAt (dir) {
  try {
    return {
      head: execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: dir }).trim(),
      short: execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: dir }).trim()
    }
  } catch {
    return null
  }
}

const fixedArgs = {
  list: ['list'],
  state: ['state'],
  stopAll: ['stop', '--all']
}

function runYamf (args, cwd = process.cwd(), { env: extraEnv = null } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const node = process.env.YAMF_PERF_NODE || process.execPath
    const childEnv = extraEnv ? { ...process.env, ...extraEnv } : process.env
    const p = spawn(node, [yamfBin, ...args], {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    })
    let err = ''
    p.stderr.on('data', (c) => { err += String(c) })
    p.on('error', reject)
    p.on('close', (code) => {
      const duration_ms = Math.round(performance.now() - t0)
      resolve({ code, duration_ms, stderr_tail: err.slice(-2000) })
    })
  })
}

function meta (cwd, phaseLabel = '0-baseline') {
  return {
    phase: phaseLabel,
    git: gitAt(yamfRepoRoot),
    cwd,
    yamfBin,
    node: process.version,
    at: new Date().toISOString(),
    env: {
      YAMF_REGISTRY_URL: process.env.YAMF_REGISTRY_URL,
      YAMF_GATEWAY_URL: process.env.YAMF_GATEWAY_URL,
      YAMF_PM3_STOP_GRACE_MS: process.env.YAMF_PM3_STOP_GRACE_MS,
      YAMF_GRACEFUL_SHUTDOWN_MS: process.env.YAMF_GRACEFUL_SHUTDOWN_MS,
      YAMF_PM3_STOP_POLL_MS: process.env.YAMF_PM3_STOP_POLL_MS,
      YAMF_DEV_DEBOUNCE_MS: process.env.YAMF_DEV_DEBOUNCE_MS,
      YAMF_HOME: process.env.YAMF_HOME
    }
  }
}

/**
 * @param {string} label - human label
 * @param {string[]} args - argv for yamf
 * @param {*} r
 */
function rowLabeled (label, args, r) {
  const o = { label, args, code: r.code, duration_ms: r.duration_ms }
  if (r.code !== 0 && r.stderr_tail) o.stderr_tail = r.stderr_tail
  return o
}

function rowScenario (scenario, r, args = null) {
  const o = { scenario, code: r.code, duration_ms: r.duration_ms }
  if (args) o.args = args
  if (r.code !== 0 && r.stderr_tail) o.stderr_tail = r.stderr_tail
  return o
}

/**
 * Resolve env-driven commands; returns { skip: string } or { args: string[] }
 */
function resolveStart () {
  const t = process.env.YAMF_PERF_START_TARGET
  if (!t) return { skip: 'YAMF_PERF_START_TARGET' }
  return { args: ['start', t] }
}

function resolveDeploy () {
  const s = process.env.YAMF_PERF_DEPLOY_LOCAL_SERVICE
  if (!s) return { skip: 'YAMF_PERF_DEPLOY_LOCAL_SERVICE' }
  const args = ['deploy', '--local', s]
  const rep = process.env.YAMF_PERF_DEPLOY_REPLICAS
  if (rep != null && rep !== '') {
    const n = Number(rep)
    if (Number.isFinite(n)) {
      args.push('-i', String(n))
    }
  }
  return { args }
}

function resolveRestart () {
  const t = process.env.YAMF_PERF_RESTART_TARGET
  if (!t) return { skip: 'YAMF_PERF_RESTART_TARGET' }
  const args = ['restart']
  if (process.env.YAMF_PERF_RESTART_ROLLING === '1') args.push('--rolling')
  args.push(t)
  return { args }
}

function resolveBuild () {
  const s = process.env.YAMF_PERF_BUILD_SERVICE
  if (!s) return { skip: 'YAMF_PERF_BUILD_SERVICE' }
  return { args: ['build', s] }
}

async function runSteps (steps, cwd) {
  const runs = []
  for (const step of steps) {
    if (step.skip) {
      runs.push({ label: step.label, skipped: true, reason: step.skip })
      continue
    }
    if (step.args) {
      const r = await runYamf(step.args, cwd)
      runs.push(rowLabeled(step.label, step.args, r))
    }
  }
  return runs
}

/** Build baseline0 step list: core + stop + stopAll, then optional extras from env */
function baseline0Steps () {
  const steps = [
    { label: 'list', args: ['list'] },
    { label: 'state', args: ['state'] }
  ]
  if (process.env.YAMF_PERF_STOP_TARGET) {
    steps.push({ label: 'oneStop', args: ['stop', process.env.YAMF_PERF_STOP_TARGET] })
  }
  if (process.env.YAMF_PERF_DANGER_STOP_ALL === '1') {
    steps.push({ label: 'stopAll', args: ['stop', '--all'] })
  }
  const extras = (process.env.YAMF_PERF_BASELINE0_EXTRAS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const ex of extras) {
    if (ex === 'build') {
      const v = resolveBuild()
      if (v.skip) steps.push({ label: 'build', skip: v.skip })
      else steps.push({ label: 'build', args: v.args })
    } else if (ex === 'start') {
      const v = resolveStart()
      if (v.skip) steps.push({ label: 'start', skip: v.skip })
      else steps.push({ label: 'start', args: v.args })
    } else if (ex === 'deploy') {
      const v = resolveDeploy()
      if (v.skip) steps.push({ label: 'deploy', skip: v.skip })
      else steps.push({ label: 'deploy', args: v.args })
    } else if (ex === 'restart') {
      const v = resolveRestart()
      if (v.skip) steps.push({ label: 'restart', skip: v.skip })
      else steps.push({ label: 'restart', args: v.args })
    }
  }
  return steps
}

function argvScenarios () {
  const raw = process.argv.slice(2)
  if (raw[0] === '--' && raw.length > 1) {
    return raw.slice(1)
  }
  return raw
}

const HELP_SCENARIOS = [
  ...FIXED_SCENARIOS,
  'oneStop (env: YAMF_PERF_STOP_TARGET)',
  'start (YAMF_PERF_START_TARGET)',
  'deploy (YAMF_PERF_DEPLOY_LOCAL_SERVICE; optional YAMF_PERF_DEPLOY_REPLICAS)',
  'restart (YAMF_PERF_RESTART_TARGET; optional YAMF_PERF_RESTART_ROLLING=1)',
  'build (YAMF_PERF_BUILD_SERVICE)'
].join('\n  ')

async function runAdHocScenario (name, cwd) {
  if (name === 'oneStop') {
    if (!process.env.YAMF_PERF_STOP_TARGET) {
      return { row: { scenario: 'oneStop', skipped: true, reason: 'YAMF_PERF_STOP_TARGET' } }
    }
    const args = ['stop', process.env.YAMF_PERF_STOP_TARGET]
    const r = await runYamf(args, cwd)
    return { row: rowScenario('oneStop', r, args) }
  }
  if (name === 'start') {
    const v = resolveStart()
    if (v.skip) return { row: { scenario: 'start', skipped: true, reason: v.skip } }
    const r = await runYamf(v.args, cwd)
    return { row: rowScenario('start', r, v.args) }
  }
  if (name === 'deploy') {
    const v = resolveDeploy()
    if (v.skip) return { row: { scenario: 'deploy', skipped: true, reason: v.skip } }
    const r = await runYamf(v.args, cwd)
    return { row: rowScenario('deploy', r, v.args) }
  }
  if (name === 'restart') {
    const v = resolveRestart()
    if (v.skip) return { row: { scenario: 'restart', skipped: true, reason: v.skip } }
    const r = await runYamf(v.args, cwd)
    return { row: rowScenario('restart', r, v.args) }
  }
  if (name === 'build') {
    const v = resolveBuild()
    if (v.skip) return { row: { scenario: 'build', skipped: true, reason: v.skip } }
    const r = await runYamf(v.args, cwd)
    return { row: rowScenario('build', r, v.args) }
  }
  if (fixedArgs[name]) {
    const r = await runYamf(fixedArgs[name], cwd)
    return { row: rowScenario(name, r, fixedArgs[name]) }
  }
  return { err: { scenario: name, error: 'unknown_scenario' } }
}

/**
 * Combinatorial Phase 1: same scenarios under multiple env variants (e.g. SIGTERM poll interval).
 * Re-run to compare; destructive steps (stop --all) are opt-in.
 */
async function runPhase1 (cwd) {
  const extraPoll = (process.env.YAMF_PERF_PHASE1_EXTRA_POLL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const pollVariants = [
    { label: 'default_poll', extraEnv: {} },
    { label: 'poll_50', extraEnv: { YAMF_PM3_STOP_POLL_MS: '50' } },
    ...extraPoll.map((n) => ({ label: `poll_${n}`, extraEnv: { YAMF_PM3_STOP_POLL_MS: n } }))
  ]
  const variants = []
  for (const v of pollVariants) {
    const block = { label: v.label, env: v.extraEnv, runs: [] }
    const r1 = await runYamf(fixedArgs.list, cwd, { env: v.extraEnv })
    block.runs.push(rowLabeled('list', fixedArgs.list, r1))
    const r2 = await runYamf(fixedArgs.state, cwd, { env: v.extraEnv })
    block.runs.push(rowLabeled('state', fixedArgs.state, r2))
    if (process.env.YAMF_PERF_STOP_TARGET) {
      const args = ['stop', process.env.YAMF_PERF_STOP_TARGET]
      const r3 = await runYamf(args, cwd, { env: v.extraEnv })
      block.runs.push(rowLabeled('oneStop', args, r3))
    } else {
      block.runs.push({ label: 'oneStop', skipped: true, reason: 'YAMF_PERF_STOP_TARGET' })
    }
    if (process.env.YAMF_PERF_DANGER_STOP_ALL === '1') {
      const r4 = await runYamf(fixedArgs.stopAll, cwd, { env: v.extraEnv })
      block.runs.push(rowLabeled('stopAll', fixedArgs.stopAll, r4))
    }
    variants.push(block)
  }
  return {
    ...meta(cwd, '1-combinatorial'),
    kind: 'phase1',
    note:
      'Per-variant: list, state, oneStop (needs YAMF_PERF_STOP_TARGET), optional stopAll (YAMF_PERF_DANGER_STOP_ALL=1). ' +
        'YAMF_PERF_PHASE1_EXTRA_POLL=100,200 adds poll variants. Child env is merged; compare duration_ms across variants.',
    matrix: { dimensions: ['YAMF_PM3_STOP_POLL_MS (via YAMF_PM3_STOP_POLL_MS)'], rows: pollVariants.map((p) => p.label) },
    variants
  }
}
async function runBaseline0 (cwd) {
  return {
    ...meta(cwd),
    kind: 'baseline0',
    note:
      'Optional: YAMF_PERF_DANGER_STOP_ALL=1, YAMF_PERF_STOP_TARGET, YAMF_PERF_BASELINE0_EXTRAS=build,deploy,start,restart (comma; each needs its env).',
    runs: await runSteps(baseline0Steps(), cwd)
  }
}

function printHelp () {
  console.log(`yamf perf measurement (Phase 0 / ad-hoc)

  node measure.mjs [scenario ...]
  node measure.mjs --baseline0
  node measure.mjs --phase1

Scenarios (fixed + env-driven):
  ${HELP_SCENARIOS}

  YAMF_PERF_CWD          Working directory for yamf (default: process.cwd)
  YAMF_PERF_DANGER_STOP_ALL=1  — with --baseline0 or --phase1, add "yamf stop --all" (kills the stack)
  YAMF_PERF_BASELINE0_EXTRAS=build,deploy,start,restart  — append to --baseline0 if envs set
  --phase1               Combinatorial list/state/oneStop per poll env (see perf/CLI-PERF-PLAN.md Phase 1)

Examples:
  YAMF_PERF_CWD=examples/minimal-hmr node measure.mjs list state
  YAMF_PERF_CWD=... YAMF_PERF_DEPLOY_LOCAL_SERVICE=minimal-api YAMF_REGISTRY_URL=... \\
    node measure.mjs list state deploy
`)
}

async function main () {
  const raw = argvScenarios()
  if (raw[0] === '-h' || raw[0] === '--help' || raw.length === 0) {
    printHelp()
    return
  }

  if (raw[0] === '--baseline0') {
    const cwd = process.env.YAMF_PERF_CWD || process.cwd()
    const out = await runBaseline0(cwd)
    console.log(JSON.stringify(out, null, 2))
    return
  }

  if (raw[0] === '--phase1') {
    const cwd = process.env.YAMF_PERF_CWD || process.cwd()
    const out = await runPhase1(cwd)
    console.log(JSON.stringify(out, null, 2))
    return
  }

  const cwd = process.env.YAMF_PERF_CWD || process.cwd()
  const out = { ...meta(cwd), kind: 'ad-hoc', runs: [] }

  for (const name of raw) {
    const { row, err } = await runAdHocScenario(name, cwd)
    if (err) out.runs.push(err)
    else out.runs.push(row)
  }

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
