# Test plan: follow-up backlog (YAMF)

Consolidated **remaining** test and coverage work that is **out of scope** of the [under-50% gap plan](./TEST-PLAN-UNDER-50.md) or **deferred** after the first passes on CLI, client (`patch-dom` / `ssr-hydrate`), and [`@yamf/services-dev-hmr`](./TEST-PLAN-CLIENT-AND-DEV-HMR.md). Treat this as **near-term debt** before “horizon” R&D; see the [YAMF roadmap](./ROADMAP.md) index for placement.

**Non-goal:** 100% line coverage of `cli.js` dispatch (optional refactor below) or of every service’s logging.

---

## Core

| Item | Suggestion | Notes |
|------|------------|--------|
| **`replica-helpers` (`getReplicasFor`, `listServiceLocations`, …)** | Unit tests for pure branches and edge cases (empty registry state, single replica). | See Tier C in [TEST-PLAN-UNDER-50.md](./TEST-PLAN-UNDER-50.md). |
| **Registry / cache** | [Slice E](./ROADMAP.md) coalesced bulk cache updates: once shipped, add integration tests for the bulk wire path and backward compatibility with `cacheBulk: false` subscribers. | Tracks roadmap Phase 1. |

---

## CLI

| Item | Suggestion | Notes |
|------|------------|--------|
| **Dispatch** | Optional `Map` of `subcommand → import + run` and/or `dispatchYamfCli(argv)` for routing assertions without `execSync`. | [TEST-PLAN-UNDER-50.md](./TEST-PLAN-UNDER-50.md) *CLI router*; low ROI until many subcommands churn. |
| **Deeper subcommand success** | Full `init --dev`, `deploy` harness success, and `start` with real entrypoints already live in `cli-journey.js` / `cli-build-deploy-tests.js` — expand only when adding new flags or error surfaces. | |

---

## @yamf/client

| Item | Suggestion | Notes |
|------|------------|--------|
| **`patch-dom` — form / pointer** | The `interactedElements` + `morphdom` skip path for active form controls: cover with a **browser** (Playwright) or app e2e when that logic changes. | JSDOM does not model full pointer stacks. |
| **`sweepOrphanedYamfListeners`** | Optional: build a small jsdom tree with `on*` attrs referencing `yamf.__listeners__[n]` and assert orphans are removed. | |
| **SSR** | End-to-end through gateway + signed handler: keep in **app** or dedicated e2e; not a framework default suite. | |

---

## @yamf/services-dev-hmr

| Item | Suggestion | Notes |
|------|------------|--------|
| **Handler return** | Assert `publishMessage` + channel handler return value includes `{ sent: N }` when multiple clients (optional). | `dev-hmr-service-tests.js` already covers one client + payload. |
| **Browser + auth** | Optional `DEPLOY_TOKEN` gating for browser `EventSource` and gateway URL docs (see [ROADMAP](./ROADMAP.md) D2 follow-up). | Product/security, not unit-test only. |

---

## How to run existing suites (quick reference)

- CLI: [TESTING.md](./TESTING.md) — `cli-command-validation`, `cli-registry-nodes-health`, `cli-remote-registry`, etc.
- Client: `client-patch-dom`, `client-ssr-hydrate` filters under `packages/client`.
- dev-hmr: `pnpm --filter @yamf/services-dev-hmr test`.
