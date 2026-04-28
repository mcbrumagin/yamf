# Test plan: coverage gaps (&lt;50% statement areas)

This is a **living backlog** for low-coverage, high-value surfaces. Tiers are ordered by **impact on deploy/ops**, not by line count.

**Non-goals:** chasing 100% on `cli.js` (see *CLI dispatch* below) or on `@yamf/client` DOM code unless the goal explicitly includes UI.

## CLI `cli.js` “router” (clarification)

There is **no separate router package** to refactor. The dispatch table is the **`switch (subcommand)`** in `packages/cli/src/cli.js` (lines ~35–200). A future **refactor slice** would be:

- Extract a `Map` or object of `subcommand → dynamic import + run` (same behavior).
- Optional: export `dispatchYamfCli(argv)` for unit tests that assert routing **without** `execSync` processes.

That is **optional**; command-level and library tests usually give better ROI.

---

## Tier A — Platform spine (registry + PM3 + remote deploy)

| Iteration | Target | Test style | Status |
|----------|--------|------------|--------|
| **1** | `packages/services/pm3/service.js` | Integration: `registryServer` + `createPm3Service` + `callService` / `httpRequest` for `list`, and deploy-token error path | **Done** — see `packages/services/pm3/tests/pm3-integration-tests.js` |
| 2 | `services/deploy-router` (`placement.js`, `service.js`) | Unit (placement) + one registry integration for attach path | **Done** — `packages/services/deploy-router/tests/placement-tests.js`, `deploy-router-integration-tests.js` (`pnpm --filter @yamf/services-deploy-router test`) |
| 3 | `cli/commands/nodes.js`, `health.js` | CLI smokes: missing URL, unreachable URL, `--help` | **Done** — `packages/cli/src/tests/cli-registry-nodes-health-tests.js` (`yamf test -d . -f registry-nodes` from `packages/cli`) |

**Exit (Tier A):** pm3-service and deploy-router have a **happy path** and **one failure path** each in automated tests.

---

## Tier B — CLI command modules (40–60%)

| Command | Test file | Note |
|--------|------------|------|
| `describe`, `start`, `stop`, `delete`, `deploy`, `init` | `packages/cli/src/tests/cli-command-validation-tests.js` | **Help** + **arg/validation errors**; cheap **success** (`stop --all` / `delete --all` on empty `YAMF_HOME`); `start` unknown service with clean home. Deeper **success** paths remain in `cli-journey.js`, `cli-rolling-commands.js`, `cli-build-deploy-tests.js`. |

**Run (from `packages/cli`):** `yamf test -d src/tests -f command-validation`

**Exit (Tier B):** no user-facing subcommand is **only** covered by the `cli.js` switch default branch.

---

## Tier C — Defer or separate goals

Shipped work for dev-hmr and client is documented in [TEST-PLAN-CLIENT-AND-DEV-HMR.md](./TEST-PLAN-CLIENT-AND-DEV-HMR.md). **Remaining** optional items (replica-helpers, browser-only paths, e2e SSR, optional CLI dispatch refactor) are in [TEST-PLAN-FOLLOW-UP.md](./TEST-PLAN-FOLLOW-UP.md) and the [roadmap](./ROADMAP.md) (near-term test debt).

---

## How to run focused suites

- CLI: `yamf test -d packages/cli -f <substring>` (see [TESTING.md](./TESTING.md)).
- PM3 service: `pnpm --filter @yamf/services-pm3 test` or `yamf test -d packages/services/pm3 -f pm3`.
