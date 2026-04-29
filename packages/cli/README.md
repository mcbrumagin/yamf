# @yamf/cli

Command-line interface for yamf.

**Packaging (longer-term):** `PM3` and related helpers live in this package so the CLI, tests, and
`pm3-service` share one implementation. A dedicated `@yamf/pm3` (or similar) may make sense if the
core grows further; the edge CLI shape can stay version‑flexible for v1.

## Usage

```bash
yamf <command> [options]
```

## Commands

### test

Run tests using auto-discovery. Finds files that import `@yamf/test` and export plain functions.

**Requires:** `@yamf/test` (optional peer dependency—install with `pnpm add -D @yamf/test` if missing)

```bash
yamf test                 # Discover and run tests from cwd
yamf test -d packages/core   # Run tests from specified directory
yamf test -f "*user*"     # Filter by file name (basename substring or glob)
yamf test -n "testVerify*"   # Filter by test name
yamf test --list         # List discovered files without running

# Run package-local example scripts (*.example.js) as tests (basename glob)
yamf test --as-test '*.example.js' -d packages/services/cache
```

**Options:**
- `-d`, `--dir <path>` - Working directory for discovery (default: cwd)
- `-f`, `--file <pattern>` - Filter files by name (substring or * basename glob)
- `-n`, `--name <regex>` - Filter tests by name (regex or * wildcard)
- `--as-test <glob>` - Run matching `.js` files without requiring `@yamf/test` in-file (see [TESTING.md](../../docs/TESTING.md)); pattern required when flag is used
- `--include-e2e` - Include `*.e2e-tests.js` files (default: excluded)
- `--list` - List discovered suites/files without running
- `-v`, `--verbose` - Verbose output

**Environment:** Loads `.env.test` from the working directory (or walks up to find it) before running.

## Dev + Build Notes

- `yamf dev` / `yamf init --dev` local mode uses `YAMF_REGISTRY_URL` when set. If unset, it first tries the last local registry URL from PM3 state, then falls back to `http://127.0.0.1:20000` (same target used by dev bootstrap). If your stack uses another port (for example `:4000`), set `YAMF_REGISTRY_URL` explicitly.
- When auto-starting local dev bootstrap, CLI now performs a loopback/port sanity check first and fails fast if the configured port is already occupied (common orphan-process failure mode).
- For monolith layouts where services import code outside the entry directory, include those trees in `watch` for that service (for example `watch: ['src/lib', 'src/ffmpeg']`).
- When `build.packages` is `'external'`, bundle hash metadata includes project lockfiles. If no lockfile exists, it falls back to hashing `package.json` so dependency-only changes can still invalidate the bundle hash.

## Deploy, `yamf dev`, and `yamf:dev-reload`

- **`yamf build` / `yamf deploy --local` / `yamf deploy --remote`** share **`planAndApply`** (`lib/deploy-driver.js`) so local and remote use the same scale vs rolling decisions (see the top-level [framework roadmap](../../docs/ROADMAP.md)).
- **`yamf dev`** watches service entries, rebuilds, and deploys; after each successful apply it **publishes** on `PUBSUB_CHANNEL_YAMF_DEV_RELOAD` (`yamf:dev-reload`) with  
  `{ source: 'yamf-dev', service, hash, at }` so any subscriber (notably [`@yamf/services-dev-hmr`](../services/dev-hmr/)) can tell browsers a backend replica changed.
- **Browser coordination** (optional): a Vite app can load **`yamfVitePluginDev`** from `@yamf/client` so **Vite** `handleHotUpdate` also publishes the same channel with `{ source: 'vite', at }` (requires `YAMF_DEV=on`, `YAMF_REGISTRY_URL` in the Vite process). The client then uses **`@yamf/client/dev-hmr`** to opt into D4 (see [D4-SPA-HMR-ANALYSIS.md](../../docs/D4-SPA-HMR-ANALYSIS.md) and the [yamf README](../../README.md) *Dev and deploy in practice*).
- **Registry cache fan-out** in large fleets: registry env **`YAMF_CACHE_COALESCE_MS`** and related knobs; see the roadmap env table in [`ROADMAP.md`](../../docs/ROADMAP.md).
