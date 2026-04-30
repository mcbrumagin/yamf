# Changelog

All notable changes to published `@yamf/*` packages are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Documentation

---

## [1.0.0] - 2026-04-29

First coordinated **1.x** release line for published `@yamf/*` packages: CI pipeline (unit / integration / e2e), example discovery fixes, and docs alignment.

### Added

- Root `LICENSE` (MIT), `CONTRIBUTING.md`, and public CI workflow for the monorepo.
- [docs/V1-HARDENING.md](docs/V1-HARDENING.md) — consolidated v1 doc: recently completed work, remaining coverage / smoke‑e2e gaps, and the final API design review checkpoint.
- `yamf test --as-test <glob>` — basename glob for `*.example.js` and other scripts without `@yamf/test` imports; `.` in patterns matches literally (see `packages/cli/src/tests/cli-as-test-tests.js`).
- `@yamf/test`: `pickListenPort()` for examples/tests that must avoid fixed registry ports.
- Postgres-backed **e2e** job and `pnpm run test:e2e` (`scripts/run-e2e-tests.mjs`).
- Integration bucket: `pnpm run test:integration` (CLI tests + `scripts/run-example-tests.mjs`).
- `@yamf/services-config` README and packaged `README.md`.

### Changed

- **BREAKING (policy):** Node.js **>= 22** is the supported baseline for development and CI across first-party packages.
- **Password hashing:** On Node 24+, Argon2 (`crypto.argon2`) is used for `createArgonSaltAndHash` / `checkArgonPassword`; on Node 22–23, new hashes use **scrypt** (`scrypt1:` prefix). Existing Argon2-only rows still need Node 24+ to verify until re-hashed.
- Normalized first-party package `license` metadata to **MIT** where it was inconsistent.
- Logger: ISO timestamps in plain logs (`YAMF_LOG_TIMESTAMP=off` to disable); `LOG_JSON` emits single-line JSON via stdout.
- File-upload service: guard `onSuccess` against double `res.end` / headers-sent errors.
- HTTP server helpers: safer wrapping of `writeHead` / `setHeader` / `end` on overridden responses.
- All published workspace packages bumped to **1.0.0** for the v1 line.

### Fixed

- `--as-test '*.example.js'` no longer matches unrelated files like `media-streaming-example.js` (glob regex escapes `.`).
- `registry-token-tests`: removed stale `TODO` throw in non-dev registry token warning case.

### Documentation

- README positioning: small-to-medium production capability vs enterprise “boring reliability.”
- Contributing guide: three-tier examples layout; extension-point documentation for `registerCommand`.
- Root README: CI status badge; [TESTING.md](docs/TESTING.md) documents `--as-test` and `-f` basename filtering.

---

## Release checklist (next tag)

Use before tagging a new **v1.x** or **v2** release on the default branch:

1. **CI green** — GitHub Actions passes (`pnpm test`, `pnpm run test:integration`, `pnpm run test:e2e` where applicable, `pnpm run check:metadata`).
2. **Changelog** — move `[Unreleased]` items into a dated section; leave a fresh `[Unreleased]`.
3. **Versions** — bump `version` in each published `package.json` per semver and [CONTRIBUTING.md](CONTRIBUTING.md).
4. **Tags** — annotated tag (e.g. `v1.0.1`) and publish workflow as documented.
5. **Docs** — README badges, engine badges, [docs/V1-HARDENING.md](docs/V1-HARDENING.md).
