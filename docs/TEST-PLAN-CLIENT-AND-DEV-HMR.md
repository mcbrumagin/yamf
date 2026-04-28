# Test plan: `@yamf/services-dev-hmr` and `@yamf/client` (patch-dom, ssr-hydrate)

This doc records **what was implemented** for in-browser HMR/SSR surfaces. **Further** optional work is in [TEST-PLAN-FOLLOW-UP.md](./TEST-PLAN-FOLLOW-UP.md).

---

## `@yamf/services-dev-hmr` (`service.js`)

**Role:** EventSource service that subscribes to `PUBSUB_CHANNEL_YAMF_DEV_RELOAD` and fans out `reload` events to clients (dev-only: `YAMF_DEV=on` and `NODE_ENV !== 'production'`).

| Kind | Status |
|------|--------|
| **Null path** | **Done** — `packages/services/dev-hmr/tests/dev-hmr-service-tests.js` (`YAMF_DEV` off, `NODE_ENV=production` with `withEnv`) |
| **Integration** (registry + pubsub + `ready` / `reload`) | **Done** — same file |

**Run:** `pnpm --filter @yamf/services-dev-hmr test`

**Non-goal:** line-coverage of logging strings.

---

## `@yamf/client` — `patch-dom.js`

| Kind | Status |
|------|--------|
| `beginListenerGeneration`, `sweepOrphanedYamfListeners` (no `document`), stub `patchDOM` | **Done** — `packages/client/tests/client-patch-dom-tests.js` |
| JSDOM + morphdom | **Done** — uses `client-test-jsdom-harness.js` |
| **Form / pointer** (`interactedElements`) | Optional — browser e2e if that code changes; see [TEST-PLAN-FOLLOW-UP.md](./TEST-PLAN-FOLLOW-UP.md) |

---

## `@yamf/client` — `ssr-hydrate.js`

| Kind | Status |
|------|--------|
| `serializeSsrEvent`, `installSsrInvoke` (no `window` / mock `fetch` / uninstall), `installSsrRenderFromEventSource` | **Done** — `packages/client/tests/client-ssr-hydrate-tests.js` (shared JSDOM harness) |

**Run (from `packages/client`):** `yamf test -d . -f client-ssr` and/or `yamf test -d . -f client-patch` (substring match on basename).

**Non-goal:** full gateway e2e (app-level).

---

## How to run

- [TESTING.md](./TESTING.md) for conventions.
- Broader follow-up: [TEST-PLAN-FOLLOW-UP.md](./TEST-PLAN-FOLLOW-UP.md).
