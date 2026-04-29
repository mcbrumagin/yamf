# Contributing to YAMF

This guide applies to **all** changes in this monorepo, including work by maintainers and automated agents. When in doubt, prefer smaller PRs, explicit tests, and documentation that matches behavior.

## Prerequisites

- **Node.js** >= 22 (aligned with `@yamf/core` `engines` and CI). Use `node -v` before developing.

**Password hashes:** On Node **24+**, `createArgonSaltAndHash` / `checkArgonPassword` use native `crypto.argon2`. On Node **22–23**, new credentials use **scrypt** (hash values prefixed with `scrypt1:`). Verifying **legacy** Argon2-only hashes still requires Node 24+ unless you reset those credentials.
- **pnpm** — the repo pins a version in root `package.json` (`packageManager`). Enable via [Corepack](https://nodejs.org/api/corepack.html) or install the pinned pnpm.

```bash
corepack enable
pnpm install
```

## Monorepo layout (where code belongs)

| Area | Purpose |
|------|---------|
| `packages/core` | Kernel: registry, gateway, service API, HTTP primitives, shared wire contracts. **No npm `dependencies` at runtime** — only Node built-ins. |
| `packages/services/*` | Optional first-party services (auth, file-server, deploy-router, etc.). Keep **dependencies minimal**; justify each new package. |
| `packages/cli` | `yamf` CLI, build/deploy/dev orchestration. |
| `packages/client` | Browser/isomorphic UI library. |
| `packages/shared` | Shared helpers used by client and/or services. |
| `packages/test` | Test harness and assertions (`terminateAfter`, `withEnv`, …). |
| `examples/*` | **Public-facing** standalone examples (runnable, documented, versioned for copy-paste). |
| `packages/core/examples/*` | Deeper demos, Docker/k8s layouts, polyglot samples. Treat as **integration / reference** unless promoted to `examples/*`. |

**Rule of thumb:** If a feature can ship as an optional **`@yamf/services-*`** package or a **registry command plugin** (see below), it should not land in `packages/core` unless it is required by the kernel (discovery, routing, contracts, shared HTTP/registry semantics).

## New features

1. **Documentation** — Update the relevant README(s), [docs/ROADMAP.md](docs/ROADMAP.md) if scope crosses releases, and [docs/TESTING.md](docs/TESTING.md) if test behavior or env vars change.
2. **Example** — Add or extend a focused example under `examples/` **or** `packages/core/examples/`, with a short README describing how to run it.
3. **Tests** — Add or extend tests in the affected package (`yamf test -d <dir>`). Prefer integration tests with `terminateAfter` for server paths (see [LLM_ONBOARDING.md](LLM_ONBOARDING.md) and [docs/TESTING.md](docs/TESTING.md)).

## Bug fixes

- Include a **regression test** that would fail without the fix, unless the change is documentation-only or testing is genuinely impractical (call that out in the PR description).
- If the fix touches security, HTTP surface, or registration/gateway behavior, re-read the testing docs and add integration coverage where possible.

## Examples

- Examples must be **runnable** from their README (commands, env vars, ports).
- Prefer **automated** coverage: integration tests in the owning package, or a script invoked from CI (see root `package.json` / `.github/workflows`).
- Promote stable patterns from `packages/core/examples/` into `examples/` when they should be the primary onboarding path for v1.

## Dependencies

- **`@yamf/core`**: **Forbidden** — do not add non-optional `dependencies` to [packages/core/package.json](packages/core/package.json). `devDependencies` and `peerDependencies` are allowed as declared today.
- **`@yamf/services-*`**, CLI, client: keep dependency trees **small**; prefer stdlib and existing workspace packages. New transitive deps need a one-line justification in the PR.

## Registry command plugins (`registerCommand`)

The shipped API for extending the registry with new `yamf-command` verbs **without editing core**:

- Implementation: `packages/core/src/registry/command-router.js` — `registerCommand(state, name, handler, options)`.
- Preferred usage: on the registry server instance — `server.registerCommand(...)` (see `packages/core/src/registry/registry-server.js`).
- **Lifecycle:** handlers are keyed to a registering **service + location**; they are removed when that service unregisters.
- **Auth:** options include `requireRegistryToken`, `requireDeployToken`, `parseJsonBody`. Built-in command names are reserved.
- **Scope:** registry-local, **in-process** only — not a remote plugin loader and **not** a gateway extension point. First-party consumer: `@yamf/services-deploy-router` (`deploy-plan`, `deploy-bundle`).

New operational verbs should use this pattern (or a dedicated service package) instead of growing core.

## TODOs in runtime code

- Do not leave unexplained `TODO` / `FIXME` in paths that ship to production users without a tracked decision.
- Either **resolve** the item, **open a doc entry** in [docs/V1-READINESS.md](docs/V1-READINESS.md) or [docs/ROADMAP.md](docs/ROADMAP.md), or replace with a short comment that states the current contract (no dangling “fix me”).

## Releases and changelog

- User-facing behavior changes should have a note under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) before merge when applicable.
- See [CHANGELOG.md](CHANGELOG.md) for the **v1 release checklist** (tags, version bumps, CI green).

## License

Contributions are accepted under the **MIT** license. The [LICENSE](LICENSE) file at the repo root applies to the monorepo unless a package explicitly states otherwise (first-party packages here use MIT consistently).

## Getting help

- Architecture and testing: [LLM_ONBOARDING.md](LLM_ONBOARDING.md), [docs/TESTING.md](docs/TESTING.md), [docs/ROADMAP.md](docs/ROADMAP.md).
- v1 scope and known gaps: [docs/V1-READINESS.md](docs/V1-READINESS.md).
