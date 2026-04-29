# Changelog

All notable changes to published `@yamf/*` packages are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Root `LICENSE` (MIT), `CONTRIBUTING.md`, and public CI workflow for the monorepo.
- [docs/V1-READINESS.md](docs/V1-READINESS.md) — v1 scope, triaged TODOs, and documented non-goals.

### Changed

- **BREAKING (policy):** Node.js **>= 22** is the supported baseline for development and CI across first-party packages.
- **Password hashing:** On Node 24+, Argon2 (`crypto.argon2`) is used for `createArgonSaltAndHash` / `checkArgonPassword`; on Node 22–23, new hashes use **scrypt** (`scrypt1:` prefix). Existing Argon2-only rows still need Node 24+ to verify until re-hashed.
- Normalized first-party package `license` metadata to **MIT** where it was inconsistent.

### Documentation

- README positioning: small-to-medium production capability vs enterprise “boring reliability.”
- Contributing guide and extension-point documentation for `registerCommand`.

---

## Release checklist (v1.0.0)

Use this before tagging **v1.0.0** on the default branch:

1. **CI green** — merge only when GitHub Actions passes (`pnpm test`, `pnpm test:integration`, `pnpm run check:metadata`).
2. **Changelog** — move `[Unreleased]` items into a dated `## [1.0.0] - YYYY-MM-DD` section; leave a fresh `[Unreleased]`.
3. **Versions** — bump `version` in each published `package.json` you intend to publish (core, cli, client, shared, test, services) per semver and coupling notes in [CONTRIBUTING.md](CONTRIBUTING.md).
4. **Tags** — create an annotated tag (e.g. `v1.0.0`) and optional per-package tags if you publish independently.
5. **Publish** — `pnpm publish -r` (or your documented npm workflow) from a clean tree.
6. **Docs** — confirm README badges, engine badges, and [docs/V1-READINESS.md](docs/V1-READINESS.md) match post-release reality.
