# Changelog

All notable changes to published `@yamf/*` packages are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Slice 9 (v1 hardening):** `auth-flow-integration-tests.js` — authenticate → verifyAccess → logout with full sessions; `sqlite-smoke-integration-tests.js`; `xss-security-integration-tests.js` (demoted from misnamed e2e).
- **CLI §C coverage:** `cli-commands-coverage-tests.js`, `as-test-runner-tests.js`; expanded `deploy-driver-tests.js` and `cli-command-validation-tests.js` for `logs` / `restart` / `list`, `as-test-runner`, `planAndApply` edges, and `yamf test` guard rails.
- **CLI §C + Slice 11 additions:** `testNodesHelp` / `testNodesMissingRegistryUrl` / `testListLiveRegistryNoUrl` added to `cli-commands-coverage-tests.js`; new `pm3-unit-tests.js` for PM3 internals (pollDefaults, broadcast stop, sigterm poll ms, pruneDeadProcesses with temp state).
- **Deploy observability ring buffer:** `registry.deployHistory` (max 20 entries) populated by `registerDeployRouter` on each plan decision; exposed as `deployEvents` in the `HEALTH` response. `yamf status --health` prints a "recent deploys" table.
- **`yamf status --versions --since <iso>`:** filters replica output to entries registered on or after the given ISO 8601 timestamp.

### Changed

- **Slice 10 (v1 hardening):** `HttpError` import in registry/gateway `http-route-handler.js`; new core tests for `route-registry`, `bundle-store`, `http-route-handler`; shared `validateSchema` null guard test; access-control e2e uses ephemeral registry/gateway ports when defaults are taken; CLI high-impact tests (see Added).
- **Slice 11 (v1 hardening, partial):** `notifyRegistryOfPureService` now never throws (`getRegistryConfig()` moved inside the try block; returns `null` when no `YAMF_REGISTRY_URL`). Redundant outer `try/catch` removed from `createPureService` and `createPureSubscriptionService`. `undefined` sentinel dropped from `pureServiceWrapper.before` — callers must return `Next` explicitly to skip.
- **CLI:** `cli.js` entry detection uses `realpathSync` so global installs work when `process.argv[1]` is a symlink (e.g. `…/bin/yamf` → `…/cli.js`); the previous `resolve()`-only check skipped `main()` and exited with no output.
- **CLI manifest (v1 hardening slice 8):** `yamf.config.js` service field `replicaKey` → `registeredServiceName` (in-bundle registered name when it differs from manifest `name`). `loadYamfConfig` migrates legacy `replicaKey` on read. `planAndApply` / rolling resolution use the new field.
- **Environment (v1 hardening slice 6):** `YAMF_RETRY_DELAY` → `YAMF_RETRY_DELAY_MS` (legacy name still read as fallback). Framework booleans prefer `true`/`false`; `env-config` parses `on`/`off`/`yes`/`no` where unambiguous. Renamed: `MUTE_LOG_GROUP_OUTPUT` → `YAMF_LOG_QUIET_GROUPS`, `MUTE_SUCCESS_CASES` → `YAMF_TEST_QUIET_PASSES`, `DISABLE_ALL_CUSTOM_LOGS` → `YAMF_LOG_DISABLE_CUSTOM`. Logger and `@yamf/test` runner now read **`YAMF_*` only** for those three (pre‑v1 unprefixed names removed). Canonical Postgres test URL: `YAMF_TEST_POSTGRES_URL` (falls back to `YAMF_TEST_PSQL_URL`, `TEST_PSQL_URL`). Replica metadata field `node` → `nodeId` in registry state / `REGISTRY_PULL` (clients may still send `node` during migration). `YAMF_AS_TEST` child env is now `true` instead of `1`.
- **CLI (v1 hardening slice 7):** subcommand `Map` + `dispatchYamfCli`; `registry` / `gateway` namespaces; `auth` command removed; flag/help work per `docs/V1-HARDENING.md` Slice 7.

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
