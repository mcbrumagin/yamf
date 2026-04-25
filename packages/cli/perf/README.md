# CLI perf baselines (Phase 0)

Full methodology: [CLI-PERF-PLAN.md](./CLI-PERF-PLAN.md).

## Quick start

From the **yamf** workspace root (`…/gitea/yamf`):

```bash
# read-only: list + state
YAMF_PERF_CWD=examples/minimal-hmr pnpm --filter @yamf/cli run perf:measure -- list state
```

Or from this package:

```bash
cd packages/cli
YAMF_PERF_CWD=../../examples/minimal-hmr pnpm run perf:measure -- list state
YAMF_PERF_CWD=../../examples/minimal-hmr pnpm run perf:baseline0
```

Save JSON under `packages/cli/perf/baselines/` (all `*.json` there are gitignored):

```bash
cd /path/to/yamf
YAMF_PERF_CWD=examples/minimal-hmr pnpm --filter @yamf/cli run perf:measure -- list state \
  | tee packages/cli/perf/baselines/local-$(date -u +%Y%m%dT%H%M%S).json
```

### PM3 / deploy scenarios (env-driven)

| Scenario | Invoked as | Required env |
|----------|------------|--------------|
| `build` | `build` | `YAMF_PERF_BUILD_SERVICE` (e.g. `minimal-api`) |
| `deploy` | `deploy` | `YAMF_PERF_DEPLOY_LOCAL_SERVICE` + `yamf.config.js`, built bundle, `YAMF_REGISTRY_URL` |
| `start` | `start` | `YAMF_PERF_START_TARGET` (filepath or service name PM3 knows) |
| `restart` | `restart` | `YAMF_PERF_RESTART_TARGET`; optional `YAMF_PERF_RESTART_ROLLING=1` |

If env is missing, the run is **`skipped: true`** with a `reason` (safe with a stopped stack).

Example (registry up, example as cwd, after `yamf build minimal-api`):

```bash
export YAMF_REGISTRY_URL=http://127.0.0.1:20000
export YAMF_PERF_CWD=examples/minimal-hmr
export YAMF_PERF_DEPLOY_LOCAL_SERVICE=minimal-api
pnpm --filter @yamf/cli run perf:measure -- list state deploy
```

**`--baseline0` extras** (after `list` / `state` / optional stop / stop-all): set
`YAMF_PERF_BASELINE0_EXTRAS=build,deploy,start,restart` (comma-separated). Each step runs only if
its env is set; otherwise a skipped row is recorded.

**Full teardown** (records `stop --all` time — stops the dev stack):

```bash
YAMF_PERF_CWD=examples/minimal-hmr YAMF_PERF_DANGER_STOP_ALL=1 \
  pnpm --filter @yamf/cli run perf:baseline0
```

## Scripts (see `package.json` in this package)

| Script | |
|--------|--|
| `perf:measure` | `node perf/measure.mjs` — pass args after `--` |
| `perf:baseline0` | same as `measure.mjs --baseline0` |

Record `YAMF_PM3_STOP_GRACE_MS` / `YAMF_GRACEFUL_SHUTDOWN_MS` when comparing runs.

**If the harness fails to spawn the CLI** (`spawn ENOENT` for `node` or a bogus path), set an explicit Node binary, e.g. `YAMF_PERF_NODE=$(command -v node)`.
