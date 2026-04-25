# CLI performance: measurement, combinations, and improvement plan

## Problem trace (what we fixed / what to watch)

### 1) Rolling replace multiplied every stopped PM3 row (fixed in PM3)

`resolveByServiceName` returned **all** state keys with that service, including `status: 'stopped'`
and dead PIDs. `restartRolling` then ran **one spawn + stop** per key. Stale keys (e.g. an old
bundle hash `60e9c277` already stopped) still had `services['minimal-api']` set, so every deploy
tried to "replace" them — `stopOne` logged "already stopped" while a **new** `de6f40` process
was still created each time. That is **O(stale keys)** per edit, not O(running replicas).

**Mitigation:** `filterActiveProcessKeys` — only PIDs that are still alive are used for
`stop` / `restart` / `restartRolling` / `filepathForService`. Stale rows: `yamf delete` or
strip from state. Each rolling iteration reloads `state` so the loop does not use a stale
`state` snapshot.

### 2) SIGTERM wait vs lifecycle (aligned earlier)

`YAMF_GRACEFUL_SHUTDOWN_MS` (per-terminable) can exceed the old 5s PM3 wait, causing SIGKILL and
repeated work. `YAMF_PM3_STOP_GRACE_MS` and defaults were aligned in `pm3.js#stopOne`.

### 3) `yamf dev` double triggers

Editors often emit multiple fs events. **Chokidar** `awaitWriteFinish` (stability ~200ms) was added
to `dev` to reduce double builds. Tune `YAMF_DEV_DEBOUNCE_MS` (default 200) if still hot.

### 4) `stop --all` slowness (still structural)

- **Sequential** `stopOne` × N processes.
- **Each** `stopOne` waits up to `YAMF_PM3_STOP_GRACE_MS` (≈ `YAMF_GRACEFUL_SHUTDOWN_MS + 2s` by
  default) for exit after SIGTERM.
- So wall time is roughly **N × (child shutdown time)**, often **>10s per “heavy” service** in the
  worst case.

**Parallel `Promise.all(stops)`** is *not* safe with the current `saveState` pattern without
serialization or a file lock: concurrent `loadState`/`writeFile` in `stopOne` can race. A proper
faster path is: **(a)** one SIGTERM fan-out to all children, then **(b)** a single wait loop
polling all PIDs, or **(c)** a small mutex around state updates.

**Registry order:** `stopAll` keeps **registry last**; any parallel work must still stop dependents
first, then registry, as today.

## Metrics (define before optimizing)

| Metric | How to get | Initial target (iterate) |
|--------|------------|-------------------------|
| `stop:one:ms` | time `yamf stop <one bundle path#i>` (running child) | baseline |
| `stop:all:ms` | time `yamf stop --all` in a known fixture | **< 0.5 × current** (your “half”) |
| `rolling:1:ms` | one `planAndApply` rolling with 1 running replica | stable, no N× |
| `dev:rebuild:ms` | one save → `[dev] … rollout/rolling` line | no duplicate line for single save |
| `pm3:stale:count` | keys in `state.json` with `!pid` or stopped but `services` set | 0 or documented cleanup |

**Environment (record in output):** `YAMF_PM3_STOP_GRACE_MS`, `YAMF_GRACEFUL_SHUTDOWN_MS`,
`YAMF_DEV_DEBOUNCE_MS`, Node version, OS.

## Combinatorial matrix (commands × conditions)

Run the harness (or a spreadsheet from the same matrix) and save JSON before/after each change.

**Rows: scenarios**

1. Single minimal service, 1 replica — `stop` / `restart` / `restartRolling` (via `yamf deploy` or dev).
2. Same with **2 running** replicas (same hash).
3. **Stale PM3 only:** stopped keys + 1 running (simulates pre-fix) — `restartRolling` must touch **1** only.
4. `stop --all` with: registry + gateway + N API workers (e.g. minimal-hmr `yamf init --dev` stack).
5. **Cold** vs **warm** (second `stop` after `start` with no work).

**Columns: levers**

- Default grace vs `YAMF_PM3_STOP_GRACE_MS=5000` (faster but more SIGKILL risk).
- `YAMF_GRACEFUL_SHUTDOWN_MS` 15000 vs 5000 in the **child** (if we add integration tests for children).

**Order-dependent**

- `stopAll` (registry last), vs parallel experiment branch (future).

## Harness

- `perf/measure.mjs` — runs a short menu of `node <cli> …` and prints `duration_ms` per step.
- **Prerequisite:** a directory with `yamf.config.js`, services built, and `YAMF_REGISTRY_URL` in
  env (or use `.env.test` from integration tests as a template).

**Integration tests**

- Extend `cli-build-deploy-tests` or add `cli-pm3-perf-smoke` that:
  - Asserts `restartRolling` with 1 active + 2 stopped keys in **mocked** or **temp** `state.json`
    runs **1** `start` (mock PM3) if we inject a fake `PM3` — *optional* follow-up.
- Simpler: **assertion on log line count** / child spawn count in a subprocess test (heavier).

## Phased work

1. **Done (this round):** active-key filter for rolling, chokidar `awaitWriteFinish`, this plan + harness.
2. **Next:** Batched or parallel-signal `stop` / single wait loop; mutex on `state.json` if still serializing writes.
3. **Next:** `yamf delete --stopped` (gc PM3 dead rows) to reduce operator confusion.
4. **Optional:** `yamf dev` self-bootstrap (`init --dev` if no manifest) as separate UX work.

## Success criteria (revisit)

- After one source edit, **at most one** deploy line per service per save (no duplicate rolling storm).
- `yamf stop --all` in the minimal-hmr stack: **≥ 50% wall-time reduction** from the baseline you
  record with `measure.mjs` on this branch, *without* increasing SIGKILL rate above an acceptable
  threshold in CI logs (define threshold, e.g. 0 in default grace).
