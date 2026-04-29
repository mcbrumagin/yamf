# V1 hardening execution plan

Sequenced work that feeds **[V1-READINESS.md](./V1-READINESS.md)** and **[CHANGELOG.md](../CHANGELOG.md)**. Each item should land with tests/docs/changelog notes as appropriate.

## Status overview

| WS | Theme | Notes |
|----|--------|------|
| WS1 | CI validation | Root workflow: `unit` → `integration` → `e2e` (Postgres service); `concurrency`, `permissions: read`; integration runs CLI tests + `scripts/run-example-tests.mjs`; e2e runs `scripts/run-e2e-tests.mjs` with `YAMF_TEST_PSQL_URL`. |
| WS2 | README / drift | Per-package checklist: badges vs `package.json`, API examples vs `service.js`, `files` field, working links. Run `pnpm run check:metadata`. |
| WS3 | Examples colocation | Per-package `*.example.js` next to services; cross-package demos stay under `packages/core/examples/`; templates under top-level `examples/`; `withInlineRegistry` / `pickListenPort` in `@yamf/test`. |
| WS4 | `--as-test` | `yamf test --as-test '<glob>'` discovers by **basename glob** (literal `.` escaped); default export `run`, optional `setup`/`teardown`/`name`; see `packages/cli/src/tests/cli-as-test-tests.js`. |
| WS5 | Three test buckets | Root: `pnpm test`, `pnpm run test:integration`, `pnpm run test:e2e`; `*.e2e-tests.js` excluded unless `--include-e2e`. |
| WS6 | Targeted hardening | ISO timestamps + `LOG_JSON` lines in logger; file-upload double-end guard; security-oriented integration tests where planned. |
| WS7 | TODO reconciliation | Critical runtime TODOs fixed or documented in V1-READINESS; remove stale throws / duplicate TODOs. |
| WS8 | Release cut | `CHANGELOG` **[1.0.0]**, version bumps, README CI badge, sync **V1-READINESS**. |

## Commands (operator)

```bash
pnpm install --frozen-lockfile
pnpm run check:metadata
pnpm test
pnpm run test:integration
YAMF_TEST_PSQL_URL=postgres://... pnpm run test:e2e   # or rely on CI services
```

## Related docs

- [TESTING.md](./TESTING.md) — conventions, `--as-test`, `-f` basename filter.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — examples layout and PR expectations.
- [ROADMAP.md](./ROADMAP.md) — framework direction and deferred work.
