# V1 hardening execution plan

Sequenced work that feeds **[V1-READINESS.md](./V1-READINESS.md)** and **[CHANGELOG.md](../CHANGELOG.md)**. Each item should land with tests/docs/changelog notes as appropriate.

> **Critical rework:** The original examples / `--as-test` direction made examples too test-shaped. Before treating WS3/WS4/WS5 as final, apply [V1-EXAMPLES-AS-SCRIPTS-REWORK.md](./V1-EXAMPLES-AS-SCRIPTS-REWORK.md): examples are runnable scripts first, and `yamf test --as-test -f "*.example.js"` generates/runs one sequential suite over the target file search.

## Status overview

| WS | Theme | Notes |
|----|--------|------|
| WS1 | CI validation | Root workflow: `unit` → `integration` → `e2e` (Postgres service); `concurrency`, `permissions: read`; integration runs CLI tests + `scripts/run-example-tests.mjs`; e2e runs `scripts/run-e2e-tests.mjs` with `YAMF_TEST_PSQL_URL`. |
| WS2 | README / drift | Per-package checklist: badges vs `package.json`, API examples vs `service.js`, `files` field, working links. Run `pnpm run check:metadata`. |
| WS3 | Examples colocation | Per-package `*.example.js` next to services; cross-package demos stay under `packages/core/examples/`; templates under top-level `examples/`. Examples must be runnable scripts, not test modules; see the examples-as-scripts rework. |
| WS4 | `--as-test` | Rework to boolean `--as-test` + required `-f/--file` target query, generated single sequential suite, optional `--generate`, and `--timeout`; see [V1-EXAMPLES-AS-SCRIPTS-REWORK.md](./V1-EXAMPLES-AS-SCRIPTS-REWORK.md). |
| WS5 | Three test buckets | Root: `pnpm test`, `pnpm run test:integration`, `pnpm run test:e2e`; integration should use `yamf test --as-test -f "*.example.js"` after removing `scripts/run-example-tests.mjs`. |
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
- [V1-EXAMPLES-AS-SCRIPTS-REWORK.md](./V1-EXAMPLES-AS-SCRIPTS-REWORK.md) — corrective design for examples and generated as-test suites.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — examples layout and PR expectations.
- [ROADMAP.md](./ROADMAP.md) — framework direction and deferred work.
