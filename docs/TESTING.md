# Testing conventions (YAMF)

## Default environment

`yamf test` loads `.env.test` from the working directory (see the CLI test command). In `@yamf/core`, `packages/core/.env.test` defines the normal values for `YAMF_REGISTRY_URL`, `YAMF_GATEWAY_URL`, `YAMF_REGISTRY_TOKEN`, and related settings.

**Prefer using those defaults** and relying on `terminateAfter` to shut down registry, gateway, and services so the process returns to a clean state. Do not wrap whole tests in `withEnv` just to repeat the same variables.

## `--as-test` (example scripts)

Use when files **do not** import `@yamf/test` for discovery (typical for `*.example.js`):

```bash
yamf test --as-test '*.example.js' -d packages/services/cache
```

- **`--as-test <glob>`** — required pattern when the flag is used; basename glob where only `*` is special; literal `.` matches a dot (so `*.example.js` matches `foo.example.js`, not `media-streaming-example.js`).
- **`-f` / `--file`** narrows the same basename match further.
- **`--list`** prints matched paths without running.

Each file’s **default export** is one test case (`async function run()`); named exports `export async function testSomething()` are used when there is no default. Optional exports: `name`, `setup`, `teardown`, `mute`, `solo`.

## When to use `withEnv`

Use [`withEnv` from `@yamf/test`](../packages/test/README.md#withenvvars-testfn) when the test **must temporarily change** environment for its assertions, for example:

- **Removing or altering a required variable** (e.g. `YAMF_REGISTRY_URL: undefined` to assert a startup or request error).
- **Non-default numeric or feature flags** (e.g. `YAMF_CACHE_COALESCE_MS`, `YAMF_SSR_HANDLER_TTL_MS`, rate limit knobs).
- **Distinct secrets or tokens** for one test (e.g. `YAMF_SSR_HANDLER_SECRET` so signing behavior is isolated from other cases in the same file).
- **Targeted validator / auth tests** that need a specific URL, missing `YAMF_SERVICE_URL`, or a particular `YAMF_REGISTRY_TOKEN` string.

If the only goal is “registry on a different port,” prefer **no** extra `withEnv`: align the test with `.env.test` instead of duplicating host/port literals.

## Server helpers

- Use **`terminateAfter(() => registryServer(), …, testFn)`** (and the same for gateway/services) so teardown order stays correct; see `terminateAfter` in [`packages/test/README.md`](../packages/test/README.md#terminateafterservers-testfn).
- For registry options (`broadcastShutdownOnTerminate`, `rateLimit`, optional `port`), pass a **single** options object: `registryServer({ … })` (see `registry-server.js`).

**CLI gotcha:** `yamf test -f route-tests` matches any **basename** that contains that substring, including `call-route-tests.js`, so you may run two files and get `EADDRINUSE` on the default registry port. Use a more specific `-f` / `-n` filter, or one process at a time.

## package placement

- Core integration-style tests: `packages/core/tests/`.
- **CLI (slow, `execSync`):** `packages/cli/src/tests/` — e.g. `cli-journey.js`, `cli-as-test-tests.js` (`--as-test` glob behavior). Filter: `yamf test -d packages/cli -f cli-as-test`.
- **pm3-service (integration, `registryServer` + `createPm3Service`):** `packages/services/pm3/tests/pm3-integration-tests.js` — `pnpm --filter @yamf/services-pm3 test` or `yamf test -d packages/services/pm3 -f pm3-integration`. Broader gap backlog: [TEST-PLAN-UNDER-50.md](./TEST-PLAN-UNDER-50.md).
- **deploy-router (placement + `attachDeployRouter`):** `packages/services/deploy-router/tests/` — `pnpm --filter @yamf/services-deploy-router test`.
- **`yamf nodes` / `yamf health` (registry URL):** `packages/cli/src/tests/cli-registry-nodes-health-tests.js` — `yamf test -d . -f registry-nodes` from `packages/cli`.
- **CLI subcommand help / validation / empty PM3:** `packages/cli/src/tests/cli-command-validation-tests.js` — `yamf test -d . -f command-validation` from `packages/cli`.
- **@yamf/client** `patch-dom.js`: `packages/client/tests/client-patch-dom-tests.js` — `yamf test -d . -f client-patch-dom` from `packages/client` (JSDOM harness: `client-test-jsdom-harness.js`).
- **@yamf/client** `ssr-hydrate.js`: `packages/client/tests/client-ssr-hydrate-tests.js` — `yamf test -d . -f client-ssr` from `packages/client`.
- **@yamf/client** D4 `dev-hmr.js` (`createYamfDevHmrSpaPatch`): `packages/client/tests/client-dev-hmr-tests.js` — `yamf test -d . -f dev-hmr` from `packages/client`.
- **@yamf/services-dev-hmr:** `packages/services/dev-hmr/tests/dev-hmr-service-tests.js` — `pnpm --filter @yamf/services-dev-hmr test`.
- Coverage gaps (tiers) and **follow-up test debt**: [TEST-PLAN-UNDER-50.md](./TEST-PLAN-UNDER-50.md), [TEST-PLAN-CLIENT-AND-DEV-HMR.md](./TEST-PLAN-CLIENT-AND-DEV-HMR.md) (shipped HMR/client), [TEST-PLAN-FOLLOW-UP.md](./TEST-PLAN-FOLLOW-UP.md) (remaining optional items).
- Reusable harness docs: `packages/test/README.md`.
