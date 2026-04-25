# Baseline JSON (local)

`*.json` here is **gitignored** — keep machine-local capture files as needed.

Example:

```bash
YAMF_PERF_CWD=examples/minimal-hmr node packages/cli/perf/measure.mjs list state \
  | tee packages/cli/perf/baselines/local-$(date -u +%Y%m%dT%H%M%SZ).json
```

See `../README.md` for env variables (`YAMF_PERF_DEPLOY_LOCAL_SERVICE`, etc.).
