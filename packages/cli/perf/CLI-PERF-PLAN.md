# CLI performance: baseline → combinatorial → improve → cleanup

## Initial setup (repo)

- `packages/cli/perf/baselines/` — drop Phase 0 JSON here (`*.json` is gitignored).
- `packages/cli/perf/measure.mjs` — runner; `perf/README.md` has copy-paste commands.
- **Scripts** on `@yamf/cli`: `pnpm run perf:measure -- …`, `pnpm run perf:baseline0` (from `packages/cli` or via `pnpm --filter @yamf/cli` from the yamf root).

## Goals

1. **Measure before changing** (Phase 0): numeric baselines for small, representative CLI work—especially
   **PM3** paths (`yamf list`, `yamf stop`, `yamf stop --all`, `yamf restart` …), plus anything that
   blocks on child lifecycle or I/O.
2. **Then** design **combinatorial** cases (Phase 1) from those baselines—not the other way around.
3. **Improve** the slowest, most impact-heavy commands first, using: measure → instrument (if
   needed) → patch → re-measure, until we reach **~10×** in the hot path or see clear diminishing
   returns.
4. **Decommission** ad-hoc logging/timers: remove, or keep behind `logger.debug` / a perf flag so
   normal runs stay quiet (final phase).

## Background (already fixed; keep in mind for interpretation)

- **Rolling storm:** only **active** PIDs in PM3 for stop/restart/rolling; stale `state.json` rows
  are not “replaced” repeatedly.
- **502 after deploy:** `unregisterService` now notifies the **gateway** (same as register) so
  pull-only gateways do not keep a dead second location for round-robin.
- **SIGTERM vs PM3 wait:** `YAMF_PM3_STOP_GRACE_MS` is aligned with `YAMF_GRACEFUL_SHUTDOWN_MS` in
  `pm3.js#stopOne`. Stop is **correct** but can be **slow** (sequential `stopOne`, grace per
  process). Improving *speed* is the main open PM3/CLI goal.

**Stop-all wall time** is still roughly `Σ` over children of “SIGTERM + wait until exit,” with
`stopAll` ordering **dependents first, registry last**. Parallel fan-out is not safe with today’s
unsynchronized `state.json` writes; any batching needs a design pass (lock or single-writer wait
loop).

---

## Phase 0 — Baseline captures (no combinatorial matrix yet)

**Intent:** one JSON blob per “lab session” you can file next to a git SHA: same host, same env,
so before/after diffs are meaningful.

**What to record every time**

| Field | |
|--------|--|
| `git rev-parse HEAD` (short) | |
| Node version, OS | |
| `YAMF_HOME` / `cwd` (e.g. `examples/minimal-hmr`) | |
| `YAMF_PM3_STOP_GRACE_MS`, `YAMF_GRACEFUL_SHUTDOWN_MS` | (if set) |
| `state.json` summary | process count, not full secrets |

**Commands to time (light → heavy)**

| # | Command | Load model |
|---|---------|----------------|
| 1 | `yamf list` | PM3 read + format only |
| 2 | `yamf state` (or minimal pull) | registry HTTP |
| 3 | `yamf stop <single filepath#i>` | one child, one grace window |
| 4 | `yamf stop <service-name>` (one running target) | same as 3 if one replica |
| 5 | `yamf stop --all` | full stack (e.g. dev-bootstrap + 2× same bundle = ~26s observed) — **destructive** |
| 6 | `yamf build <svc>` | via harness scenario `build` + `YAMF_PERF_BUILD_SERVICE` |
| 7 | `yamf deploy --local <svc>` | `deploy` + `YAMF_PERF_DEPLOY_LOCAL_SERVICE` (needs registry, bundle) |
| 8 | `yamf start <path\|name>` | `start` + `YAMF_PERF_START_TARGET` |
| 9 | `yamf restart [–rolling] <target>` | `restart` + `YAMF_PERF_RESTART_TARGET` |

**Harness** — [perf/README.md](./README.md) has pnpm commands from the yamf root; `measure.mjs`
strips a leading `--` so `pnpm run perf:measure -- list` works.

`--baseline0` runs: `list`, `state`, optional `oneStop` / `stop --all` (same env flags as before).
Optional **`YAMF_PERF_BASELINE0_EXTRAS=build,deploy,start,restart`** appends those steps when each
step’s env is set; otherwise a **`skipped`** row records why (so a stopped stack still yields a
valid JSON).

**Deliverable:** JSON under `packages/cli/perf/baselines/` (`*.json` gitignored), e.g.
`local-YYYYMMDDTHHMMSS.json`, plus your git SHA in the commit message or a one-line note.

---

## Phase 1 — Combinatorial cases + improvement loop (recursive until ~10× or “done”)

**When:** after Phase 0 baselines exist for at least one **representative** stack (e.g. minimal-hmr
dev) and a **trivial** stack (1 fake child) if you add a fixture later.

**Combinatorial matrix (draft)** — add rows/columns as needed from real baselines.

| Dimension | Examples |
|------------|----------|
| Process count | 1, 2 (same hash), 5+ |
| stack shape | “API only” vs “dev-bootstrap (registry+gateway+pm3+app)” |
| child behavior | long vs short graceful shutdown; `YAMF_GRACEFUL_SHUTDOWN_MS` in child |
| env | min / default / aggressive `YAMF_PM3_STOP_GRACE_MS` |
| order | `stopAll` (registry last) vs future batched-signal design |

**Loop (repeat for each high-impact target, usually **slowest first** unless a cheaper win is
obvious):**

1. Run the **target** scenario (from matrix + Phase 0 harness).
2. If the hotspot is unclear, **instrument** (temporary `performance.now` or `logger.debug` around
   `loadState` / `stopOne` / `sleep` in `pm3.js`—*remove or demote in final phase*).
3. **Analyze** (profile: where does wall time go—grace wait, JSON I/O, serial waits?).
4. **Patch** (e.g. batched SIGTERM + single wait loop with one writer, or a lock—only after design).
5. **Re-measure**; compare to Phase 0 JSON at same `cwd` and env.
6. Stop this command when: **~10×** improvement on that scenario, or no further low-risk wins.

Then move to the **next** slowest command or scenario from the matrix.

---

## Final phase — Cleanup

- Remove one-off `console.log` / inline timers from hot paths, **or** gate with `debug` and document
  `YAMF_*` for perf.
- Keep `perf/measure.mjs` and this doc as the **durable** harness; no requirement to run in CI
  unless you add a non-destructive smoke (e.g. `list` + `state` only, tight timeout).

## Success (project-level)

- Phase 0 baselines on disk for the stacks you care about.
- **Stop / stop-all** measurably faster on the same hardware (start with **2×** as a first internal
  milestone; **10×** as stretch where architecture allows) **without** turning clean shutdown into
  mass SIGKILL at default env.
- Combinatorial cases documented and re-runable from `measure.mjs` + env flags, not ad-hoc shell
  one-liners only.
