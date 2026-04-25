# CLI timing helper

Ad-hoc timings via `perf/measure.mjs` (JSON to stdout). Baseline JSON under `baselines/` is gitignored locally.

## Quick start

From the **yamf** workspace root:

```bash
YAMF_PERF_CWD=examples/minimal-hmr pnpm --filter @yamf/cli run perf:measure -- list state
```

Or from `packages/cli`:

```bash
YAMF_PERF_CWD=../../examples/minimal-hmr pnpm run perf:measure -- list state
pnpm run perf:baseline0
```

`measure.mjs --help` lists scenarios and env flags (`YAMF_PERF_*`).

**If spawn fails** (bad `node` path), set `YAMF_PERF_NODE=$(command -v node)`.

## Scripts

| Script | |
|--------|--|
| `perf:measure` | `node perf/measure.mjs` — pass args after `--` |
| `perf:baseline0` | `measure.mjs --baseline0` |
| `perf:phase1` | combinatorial poll variants (`--phase1`) |

Record `YAMF_PM3_STOP_GRACE_MS` / `YAMF_GRACEFUL_SHUTDOWN_MS` when comparing runs.
