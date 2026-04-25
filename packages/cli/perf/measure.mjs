#!/usr/bin/env node
/**
 * Ad-hoc CLI timing helper for PM3 / yamf stop / list (see CLI-PERF-PLAN.md).
 *
 * Usage (from a project that has yamf + registry, e.g. examples/minimal-hmr with env set):
 *   YAMF_REGISTRY_URL=http://127.0.0.1:20000 \
 *   node /path/to/yamf/packages/cli/perf/measure.mjs list
 *   node .../measure.mjs list stopAll
 *
 * If no subcommands, runs: list, stop (requires YAMF_PERF_STOP_TARGET, e.g. a filepath#0).
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const cliDir = fileURLToPath(new URL('..', import.meta.url))
const yamfBin = join(cliDir, 'src/cli.js')

const scenarios = {
  list: { args: ['list'], needRegistry: true },
  state: { args: ['state'], needRegistry: true },
  stopAll: { args: ['stop', '--all'], needRegistry: false }
}

function runYamf (args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const p = spawn(process.execPath, [yamfBin, ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
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

async function main () {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : ['list']
  if (want[0] === '-h' || want[0] === '--help') {
    console.log(`Usage: node measure.mjs [scenarios...]

Built-in: ${Object.keys(scenarios).join(', ')}

Env (optional):
  YAMF_PERF_CWD  Working directory (default cwd)
  YAMF_PERF_STOP_TARGET  e.g. /abs/path/bundle.mjs#0  — for "oneStop" (not in default menu)

Current defaults run: list (and you can add stopAll when safe).`)
    return
  }

  const cwd = process.env.YAMF_PERF_CWD || process.cwd()
  const out = { cwd, yamfBin, node: process.version, env: {
    YAMF_PM3_STOP_GRACE_MS: process.env.YAMF_PM3_STOP_GRACE_MS,
    YAMF_GRACEFUL_SHUTDOWN_MS: process.env.YAMF_GRACEFUL_SHUTDOWN_MS,
    YAMF_DEV_DEBOUNCE_MS: process.env.YAMF_DEV_DEBOUNCE_MS
  }, runs: [] }

  for (const name of want) {
    if (name === 'oneStop' && process.env.YAMF_PERF_STOP_TARGET) {
      const r = await runYamf(['stop', process.env.YAMF_PERF_STOP_TARGET], cwd)
      out.runs.push({ scenario: 'oneStop', ...r })
      continue
    }
    const def = scenarios[name]
    if (!def) {
      out.runs.push({ scenario: name, error: 'unknown_scenario' })
      continue
    }
    const r = await runYamf(def.args, cwd)
    out.runs.push({ scenario: name, code: r.code, duration_ms: r.duration_ms })
  }

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
