# Baseline JSON captures (local)

`*.json` in this directory is **gitignored** — each machine keeps its own timings.

## How to record

From the yamf repo root (see `../README.md`):

```bash
export YAMF_REGISTRY_URL=http://127.0.0.1:20000
export YAMF_GATEWAY_URL=http://127.0.0.1:3000
export YAMF_PERF_CWD=$PWD/examples/minimal-hmr   # or absolute path
node packages/cli/perf/measure.mjs list state | tee packages/cli/perf/baselines/local-$(date -u +%Y%m%dT%H%M%SZ).json
```

## Initial session (dev stack running)

| File | Command | Notes |
|------|---------|--------|
| `initial-list-state-20260425T052313Z.json` | `list state` (ad-hoc) | `list` ~85 ms, `state` ~80 ms, exit 0 |
| `initial-baseline0-readonly-20260425T052321Z.json` | `--baseline0` (no `stop --all`) | `list` ~103 ms, `state` ~80 ms |

`git.head` in each file pins the yamf monorepo revision at capture time. Re-run after PM3/CLI changes to compare.

## Env for `start` / `deploy` / `restart` / `build`

See `node packages/cli/perf/measure.mjs --help`. Typical:

- `YAMF_PERF_DEPLOY_LOCAL_SERVICE=minimal-api` — for `deploy` scenario (`yamf deploy --local …`); optional `YAMF_PERF_DEPLOY_REPLICAS`.
- `YAMF_PERF_START_TARGET` — path to `.mjs` or service name.
- `YAMF_PERF_RESTART_TARGET` — same; `YAMF_PERF_RESTART_ROLLING=1` adds `--rolling`.
- `YAMF_PERF_BUILD_SERVICE=minimal-api` — for `yamf build …` timing.

Order matters when chaining (e.g. `build deploy start restart` in one JSON).
