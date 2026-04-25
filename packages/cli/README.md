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
