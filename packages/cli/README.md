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
yamf test -f "*user*"     # Filter by file name
yamf test -n "testVerify*"   # Filter by test name
yamf test --list         # List discovered files without running
```

**Options:**
- `-d`, `--dir <path>` - Working directory for discovery (default: cwd)
- `-f`, `--file <pattern>` - Filter files by name (substring or * wildcard)
- `-n`, `--name <regex>` - Filter tests by name (regex or * wildcard)
- `--list` - List discovered suites/files without running
- `-v`, `--verbose` - Verbose output

**Environment:** Loads `.env.test` from the working directory (or walks up to find it) before running.

## Dev + Build Notes

- `yamf dev` / `yamf init --dev` local mode uses `YAMF_REGISTRY_URL` when set. If unset, it first tries the last local registry URL from PM3 state, then falls back to `http://127.0.0.1:20000` (same target used by dev bootstrap). If your stack uses another port (for example `:4000`), set `YAMF_REGISTRY_URL` explicitly.
- When auto-starting local dev bootstrap, CLI now performs a loopback/port sanity check first and fails fast if the configured port is already occupied (common orphan-process failure mode).
- For monolith layouts where services import code outside the entry directory, include those trees in `watch` for that service (for example `watch: ['src/lib', 'src/ffmpeg']`).
- When `build.packages` is `'external'`, bundle hash metadata includes project lockfiles. If no lockfile exists, it falls back to hashing `package.json` so dependency-only changes can still invalidate the bundle hash.
