# V1 hardening — final pass

Single consolidated v1 doc. Replaces the prior `V1-HARDENING.md`, `V1-READINESS.md`, `V1-EXAMPLES-AS-SCRIPTS-REWORK.md`, `TEST-PLAN-UNDER-50.md`, `TEST-PLAN-FOLLOW-UP.md`, and `TEST-PLAN-CLIENT-AND-DEV-HMR.md`.

For framework direction and shipped slice specs see [ROADMAP.md](./ROADMAP.md). For test conventions see [TESTING.md](./TESTING.md). For contribution rules see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Recently completed (post‑original‑v1‑roadmap)

Bullet‑level summary of work that landed on top of the original WS1–WS8 hardening plan and the test‑plan triage docs.

### Test pipeline & performance

- **In‑process short‑circuit + graceful remote termination.** Full test runs went from ~3m+ to **~45s** (`pnpm test`) and **~1.5m** (`pnpm test:all`).
- **Auth in‑memory cache leak fix** — `createAuthService` wraps `server.terminate` to call `cache.terminate()` first so the eviction `setInterval` is cleared. Was preventing graceful shutdown of remote auth processes.
- **`yamf test` works from repo root or any package** — `.env.test` lookup walks up from the discovery dir; root `.env.test` is the canonical default.
- **Per‑package `test:all` orchestration.** Every workspace package exposes `test:all` (= `yamf test -d . --include-e2e`); root `pnpm test:all` walks the workspace, root `pnpm test` skips CLI + minimal-hmr for the fast path.
- **`--include-e2e` semantics tightened.** Without `-f`, full‑tree runs exclude `*.e2e-tests.js` unless the flag is set; with `-f`, e2e files participate in the basename match (no surprise omissions when filtering).
- **`--as-test` simplified.** Boolean flag + required `-f`; orchestrator owns the per‑case lifecycle (free port → spawn → SIGTERM → graceful exit). Glob `.` is literal; `--generate` / `--generate-out` ship a deterministic suite under `.yamf/generated/` (gitignored).
- **Live test debug output.** Long‑running CLI tests stream child output (gated on `YAMF_TEST_DEBUG=1` / `--verbose`) so slow runs are observable without changing the runner shape; faster suites already print enough.
- **`@yamf/test`: `pickListenPort()`** for tests/examples that must avoid fixed registry ports.

### Examples are scripts, not test modules

- All `*.example.js` rewritten as runnable scripts — top‑level `await`, no `default async function run` / `name` / `mute` / `solo` exports, no `if (process.env.YAMF_AS_TEST)` branches, no in‑file `terminate()` calls.
- Lifecycle is the orchestrator's job: `yamf test --as-test -f "*.example.js"` dynamically instruments each example to pass / fail and tears it down via SIGTERM.
- Per‑package smoke examples live next to each service; cross‑package demos under `packages/core/examples/`; copy‑paste templates under top‑level `examples/`.
- `scripts/run-example-tests.mjs` deleted; `pnpm run test:integration` invokes `yamf test --as-test` directly.

### Coverage / surfaces shipped

These were the open items in the original test‑plan triage docs and are now landed:

- **CLI** — `cli-as-test-tests.js`, `cli-command-validation-tests.js`, `cli-registry-nodes-health-tests.js`, `cli-remote-registry-smoke-tests.js`, `cli-rolling-commands.js`, `cli-build-deploy-tests.js`, `cli-journey.js`, `deploy-driver-tests.js`, `deploy-remote-parse-tests.js`, `bundle-hash-tests.js`, `registry-url-tests.js`, `remote-pm3-adapter-tests.js`.
- **`@yamf/services-pm3`** — `pm3-integration-tests.js` (Tier‑A spine: registry + `createPm3Service` + happy path + deploy‑token error path).
- **`@yamf/services-deploy-router`** — `placement-tests.js` + `deploy-router-integration-tests.js`.
- **`@yamf/services-dev-hmr`** — `dev-hmr-service-tests.js` (null path + integration with `withEnv`, registry + pubsub + `ready` / `reload`).
- **`@yamf/client`** — `client-patch-dom-tests.js` (begin/sweep/stub + JSDOM + morphdom via `client-test-jsdom-harness.js`), `client-ssr-hydrate-tests.js` (signed handler RPC, install/uninstall, EventSource bridge), `client-dev-hmr-tests.js` (`createYamfDevHmrSpaPatch` D4).
- **Framework spine** — `cache-coalesce-tests.js`, `register-command-tests.js`, `contract-compatibility-tests.js`, `terminate-after-tests.js`, registry/gateway rolling + drain integration tests.

### Release plumbing

- Public CI workflow on the default branch (`unit` → `integration` → `e2e` with Postgres service); `pnpm run check:metadata` for README / `package.json` drift.
- Root `LICENSE` (MIT), `CONTRIBUTING.md`, root `CHANGELOG.md` cut to **[1.0.0]**, all first‑party packages bumped to `1.0.0` and pinned to `engines.node >= 22`.
- Logger ISO timestamps + `LOG_JSON` single‑line stdout JSON.
- File‑upload double‑`res.end` guard; HTTP server safer wrapping of overridden response writers.

---

## Remaining work / known gaps

Triaged against the latest coverage report. Order is rough impact on a pre‑v1‑lockdown consumer of yamf.

### A. Final API design review (must, before backward‑compat lockdown)

Backward compatibility becomes a hard contract at v1+, so this is the **last cheap window** to rename / collapse / re‑shape. The audit ran against every consumer‑facing surface (CLI, kernel factories, public exports, env vars, wire protocol, pub/sub channels, replica metadata, `yamf.config.js`); decisions and the sequenced cleanup are captured below. Items called out as `[B]`, `[C]`, or `[D]` interleave the relevant cleanup from §B/§C/§D into the same slice so we don't write tests against a shape we're about to rename.

#### A.1 Decisions taken

- **Service factory shape.** Kernel keeps positional: `createService(serviceName, fn, options)`, `createSubscriptionService(serviceName, channelMap, options)`, `createEventSourceService(serviceName, handlers, options)`. First‑party services stay options‑only: `createXService({ serviceName = '<default>', ... })`. The `name` parameter on `createService` becomes `serviceName` for symmetry. The `createService(fn)` reverse‑overload (where the name is taken from `fn.name`) is dropped; explicit names always. `createSubscriptionService` collapses to **map‑only** — single‑channel callers wrap as `{ channel: handler }` (uniform with `createEventSourceService(handlers)`).
- **First‑party service‑name defaults.** Kebab, no `-service` suffix. Use the *role* word, not the implementation: `'auth'`, `'cache'`, `'config'`, `'pm3'`, `'queue'`, `'sqlite'`, `'postgres'`, `'user'`, `'static-files'` (was `'static-file-service'`), `'uploads'` (was `'file-upload-service'`), `'dev-hmr'`, `'deploy-router'`. Apps can still override.
- **Boolean env vars.** Prefer `=true|false`; `env-config.parseValue` coerces `true`/`false` plus legacy `on`/`off`/`yes`/`no` (see **Slice 6**). Call sites use `envTruthy()` for one consistent interpretation.
- **Non‑`YAMF_*` env vars.** Keep widely‑recognized conventions (`LOG_LEVEL`, `NODE_ENV`, `ENVIRONMENT`, `PGUSER`/`PGPASSWORD`/`PGDATABASE`). Framework‑shaped toggles live under `YAMF_*` (see **Slice 6**: `YAMF_LOG_QUIET_GROUPS`, `YAMF_TEST_QUIET_PASSES`, `YAMF_LOG_DISABLE_CUSTOM`, `YAMF_TEST_POSTGRES_URL`, replica `nodeId`). Remove the `ADMIN_USER` / `ADMIN_PASS` default validator from `createAuthService` entirely; apps must provide their own validator. The auth tests provide their own fixture credentials.
- **`yamf auth` CLI command.** Removed. Instead, `call`, `publish`, `request`, and `yamf registry state|lookup` accept `--auth user:pass` (login → exchange for token) and `--token <token>` (raw bearer). The duplicated `-a/--auth` short form is dropped (collided with `--all`); `--auth` is long‑only.
- **Low‑level commands.** Move `state`, `lookup`, `route` under a `yamf registry` namespace (`yamf registry state <prop>`, `yamf registry lookup <filter>`, `yamf registry route <path> <svc>`, `yamf registry drain`). Reserve `yamf gateway` for the same shape (no subcommands today). Top‑level keeps the high‑frequency verbs (`status`, `health`, `list`, `describe`, `start/stop/restart/delete/clean`, `build`, `deploy`, `dev`, `init`, `test`, `logs`, `call`, `publish`, `request`, `nodes`, `drain`).
- **`init --dev` vs `yamf dev`.** Folded. `yamf dev` auto‑bootstraps a local registry+cache+pm3 if the registry isn't reachable (the partial behavior already exists). `yamf init` becomes manifest scaffolding only.
- **Plugin model.** Two distinct tiers, kept distinct. **Registry plugins** are in‑process privileged code (`registry.registerCommand(name, handler, opts)`) that hold direct state/`bundleStore` access and run after token validation; reserved for trusted code loaded at boot. The deploy router is renamed `attachDeployRouter` → `registerDeployRouter(registry, opts)` to align with that idiom and signal it is *not* a service factory. **Service‑extended commands** (apps registering custom `yamf-command` verbs against their own service handler) are deferred to post‑v1 — no consumer today, and adding it expands the wire protocol. JSDoc on `registry.registerCommand` is tightened to call out the trust boundary.
- **Federation hooks.** Minimal room: keep the `yamf-` namespace reserved and document `yamf-registry-id` semantics around the existing `REGISTRY_INSTANCE_ID` header. No new wire fields for v1.
- **Non‑JS bundle deploys.** Rename now while it's cheap: `yamf-bundle-ed25519-sig` → `yamf-bundle-signature` paired with `yamf-bundle-signature-alg: ed25519`. Header value semantics unchanged for JS bundles; the algorithm tag future‑proofs Ed448 / hybrid‑PQ rotation.

#### A.2 Sequenced implementation plan

Inside‑out: kernel wire and contract first, then services, then CLI. Each slice is a PR‑sized unit; later slices depend on earlier ones landing. Coverage and smoke‑test cleanup ride along where the test would otherwise be rewritten twice.

**Slice 1 — Wire protocol & header naming (`@yamf/core`).**
- Rename `yamf-prefer-service-location` → `yamf-service-prefer-location`.
- Rename `yamf-bundle-ed25519-sig` → `yamf-bundle-signature` and add `yamf-bundle-signature-alg` (defaults `ed25519`).
- Normalize header booleans to `'true'` / `'false'`: update `yamf-rate-limit-required`, `yamf-allow-breaking-contract`, and parsers in `parseCommandHeaders`.
- Drop the now‑redundant `yamf-cache-bulk` header (presence of `yamf-cache-window-id` implies bulk).
- Audit `yamf-route-type` `'controller'` value: keep with documentation, or remove.
- Add a `CHANNELS` enum mirroring `COMMANDS` (`DEV_RELOAD: 'yamf:dev-reload'`, `DEPLOY: 'yamf:deploy'`, `UPLOAD: 'yamf:upload'`); deprecate the loose `PUBSUB_CHANNEL_YAMF_DEV_RELOAD` constant via re‑export.
- Document the `yamf-` namespace as reserved for the framework (channels and headers).
- `[C]` Pair with coverage closures on `command-router.js` plugin path + `header-command-tests.js` updates.

**Slice 2 — Core service factory shape (`@yamf/core`).** ✓ **Landed.**
- Renamed `createService(name, …)` parameter to `serviceName` (signature stays positional).
- Dropped the `createService(fn)` reverse overload; passing a function as the first arg now throws a `TypeError` pointing at `createService('my-service', fn)`. The auto‑generated `Anon$<hex>` name path is gone, and `validateServiceName` no longer accepts `$`.
- Tightened `createSubscriptionService` to **map‑only**: `(serviceName, channelMap, options)`. The legacy single‑channel string overload now throws with a migration hint (`{ [channel]: handler }`). Stronger upfront validation: non‑object / array / empty maps and non‑string `serviceName` throw before any registry I/O.
- Standardized `gatewayServer` on options‑only (`gatewayServer({ port, ... })`). Positional `port` throws a `TypeError` matching `registryServer`'s shape. Test/README/onboarding callers migrated.
- `createRoute(path, serviceNameOrFn, dataType)` — kept `dataType` positional (single extra arg, mirrors URL → handler → content‑type). Anonymous handlers now get a deterministic auto‑name derived from the path (`/api/users/* → route-api-users`) so the explicit‑name rule for `createService` doesn't degrade common usage.
- `createServices(...fns)` — explicit options object accepted as final non‑function argument (e.g. `createServices(fn1, fn2, { sharedCache: ... })`); batch creation passes resolved `(name, fn, opts)` to `createService` instead of relying on `fn.name` overload.
- Cleanups: dead `prefetchRegistryState` placeholder removed from `service-batch.js`; unused `crypto` import removed from `create-service.js`; `validateServiceName` regex tightened.
- `[C]` Coverage added: `replica-helpers-tests.js` (pure state helpers — empty / metadata‑merge / no‑metadata branches), `call-service-cache-tests.js` (`callServiceWithCache` 404 / 403 / no‑locations / local short‑circuit), `subscription-tests.js` extended (legacy‑overload rejection, empty `serviceName`, array channel‑map). New tests use the single‑fn `terminateAfter(async () => …)` pattern where appropriate.

**Slice 3 — Public exports & subpath cleanup.** ✓ **Landed.**
- `@yamf/client`: renamed `Element.js` → `element.js` (case‑rename via `git mv` two‑step) and updated every relative import. Dropped the broken `./load-client` subpath (the file `loadClient.js` had already been replaced by `client-init.js`); replaced with `./client-init` and added `./client-utils` for symmetry. Removed the dead 5‑line `./utils` subpath and its `utils.js` file (zero consumers; only `sleep`, available from `@yamf/test`).
- `@yamf/cli`: moved `./pm3` and `./as-test-runner` to `./internal/pm3` and `./internal/as-test-runner` (subpath rename only — files stay in `lib/`). Updated the `--generate` import‑path string and `docs/TESTING.md`.
- `@yamf/services-deploy-router`: added an explicit `exports` map with `./placement` so external consumers (and future docs / examples) can import `pickNode` without filesystem fallback. Intra‑package tests keep the relative import.
- `@yamf/services-cache`: **skipped** — `createInMemoryCache` is already a named export from the main entry and the implementation hasn't been split into its own file yet. Adding a subpath without splitting is busywork; revisit when/if the cache service grows enough that splitting earns its keep.
- `@yamf/core`: culled the unused factory subpaths (`./create-service`, `./create-subscription-service`, `./create-event-source-service`, `./create-route`, `./call-service`, `./call-route`, `./publish-message`, `./gateway-server`, `./registry-server`, `./http-error`, `./logger`). Kept `./env-config`, `./crypto`, `./contract-compatibility` — each has real callers (`@yamf/cli`, `@yamf/services-auth`, `@yamf/services-user`, `examples/psql-user-auth`).
- `[D]` `vite-plugin-yamf-dev` subpath left alone (self‑namespaces, used unchanged by `examples/minimal-hmr`).

**Slice 4 — Plugin model rename (`@yamf/services-deploy-router` + `@yamf/core`).** ✓ **Landed.**
- Renamed `attachDeployRouter` → `registerDeployRouter(registry, opts)` to align with the in‑process privileged‑plugin idiom and stop reading like a service factory. Every call site updated (`cli/lib/dev-bootstrap.js`, `cli/lib/deploy-driver.js`, integration tests, smoke example, `docs/TESTING.md`, `docs/ROADMAP.md`).
- Exported `DEPLOY_COMMANDS = { PLAN: 'deploy-plan', BUNDLE: 'deploy-bundle' }` (frozen) from `@yamf/services-deploy-router`. The deploy‑driver and dev‑bootstrap now use the constants instead of stringly‑typed wire literals; tests still assert the literal values for protocol contract.
- Strengthened `registry.registerCommand` JSDoc to spell out the trust boundary: in‑process state access happens *after* token validation, only trusted boot code (canonical caller: `registerDeployRouter`) should call it, and service‑extended commands are explicitly deferred to post‑v1. Param‑level JSDoc added for every `registerCommand` option.
- `[B]` Grew `deploy-router-smoke.example.js` from a `console.log` placeholder into a real `--as-test` smoke that boots a registry, calls `registerDeployRouter`, and round‑trips a `deploy-plan` request — exercising the rename end‑to‑end. Integration tests also rewritten to the single‑fn `terminateAfter(async () => …)` pattern with multi‑predicate `assert(target, p1, p2, …)` shape; added a regression test that the legacy `attachDeployRouter` export is gone.

**Slice 5 — First‑party service factories: name + naming defaults.** ✓ **Landed.**
- Renamed `createPostgreSqlService` → `createPostgresService` and `createYamfDevHmrService` → `createDevHmrService`. Every call site (services, tests, examples, READMEs, `LLM_ONBOARDING.md`, the python README API table) updated; no aliases.
- Default `serviceName` in every first‑party factory now matches the kebab‑no‑suffix convention: `auth`, `cache`, `pm3`, `static-files`, `uploads`, `sqlite`, `postgres`, `config`. The `file-upload` `Logger({ logGroup })` followed the rename so log lines line up with the registered name.
- Registry + gateway auth special‑routing literal `DEFAULT_AUTH_SERVICE` flipped from `'auth-service'` → `'auth'` (in both `core/registry/command-router.js` and `core/gateway/command-router.js`). The `'auth-service'` *serviceType* tag stays as‑is — it's a role discriminator, distinct from the registered name. `@yamf/services-deploy-router` `pm3ServiceName` default and the CLI `remote-pm3-adapter.js` SERVICE_NAME header literal both flipped to `'pm3'`.
- Removed `ADMIN_USER` / `ADMIN_PASS` default validator from `createAuthService`. `validateUserPassword` is now a required option (`TypeError` if absent or non‑function); the `assertValidateUserPasswordSanity` probe still runs against whatever the caller passes. Auth tests now wrap with a tiny `createAuthSvc(opts)` helper that injects a fixture validator (caller‑supplied opts win via spread order, so the existing sanity‑check tests for always‑true / non‑boolean / throwing validators still exercise the right paths). `examples/all-in-one/bootstrap.js` inlines a credentials‑comparing validator since the example expected the old default.
- `[B]` deferred to Slice 9 walk for the smoke / placeholder e2e cleanup table — Slice 5 only refreshes test naming where the rename forced it. `[C]` coverage adds (auth `logoutAll` / `kid` mismatch, file‑upload quota/mime/abort, pm3 deploy/spawn errors, file‑server SPA fallback) also tracked under §C and not folded in here.

**Slice 6 — Env variable cleanup.** ✓ **Landed.**
- **`YAMF_RETRY_DELAY_MS`:** primary key for registration retry initial delay (ms); **`YAMF_RETRY_DELAY`** still read as fallback in `create-service.js` / `service-helpers.js`.
- **`env-config.parseValue`:** recognizes `on`/`off`/`yes`/`no` (case‑insensitive) as booleans in addition to `true`/`false`. **`envTruthy()`** exported from `@yamf/core` for consistent boolean reads (accepts `1`/`0` strings and numeric flags).
- **Renamed framework envs:** `MUTE_LOG_GROUP_OUTPUT` → **`YAMF_LOG_QUIET_GROUPS`**, `MUTE_SUCCESS_CASES` → **`YAMF_TEST_QUIET_PASSES`**, `DISABLE_ALL_CUSTOM_LOGS` → **`YAMF_LOG_DISABLE_CUSTOM`** — logger and `@yamf/test` runner read **`YAMF_*` only** (unprefixed names removed). All `**/.env.test` files and integration test env objects use the new names.
- **Boolean reads migrated** off raw `=== '1'` / `=== 'on'` in CLI (`dev`, `list`, tests), `@yamf/test` (`runner`, `helpers` teardown), `deploy-driver`, `as-test-runner`, `pm3` (`YAMF_PM3_STOP_REGISTRY_BROADCAST`), `create-service` / `service-helpers` (`YAMF_DEPLOY_ALLOW_BREAKING`, `YAMF_EXTRACT_SERVICE_CONTRACT`), `csp.js` (`YAMF_HSTS`, `YAMF_CSP_RELAXED`), `logger.js` (`YAMF_LOG_TIMESTAMP`, `LOG_JSON`), `@yamf/services-auth` (`YAMF_AUTH_EPHEMERAL`), `@yamf/services-dev-hmr` + `dev-bootstrap` + Vite plugin (`YAMF_DEV`). `YAMF_AS_TEST` child value is now **`true`** (not `1`). `YAMF_TEST_TIMINGS` / `YAMF_TEST_DEBUG` / `YAMF_TEST_VERBOSE_TEARDOWN` use the same coercion path; `yamf test --timings` sets `true` and reloads `env-config`.
- **Postgres test URL:** canonical **`YAMF_TEST_POSTGRES_URL`**; code and e2e smoke fall back to `YAMF_TEST_PSQL_URL` and `TEST_PSQL_URL`. CI workflow and examples updated; **`CHANGELOG.md`** migration note under `[Unreleased]`.
- **Replica metadata:** registered field is **`nodeId`** (was `node`). `service-helpers` sends `nodeId`; `service-registry` stores `nodeId` and still accepts legacy **`node`** on register. `pickNode` / placement tests / `replica-helpers-tests` / `yamf status --versions` use **`nodeId`** (with read‑side fallback for old rows).

**Slice 7 — CLI: flag normalization, command grouping, command surface.** ✓ **Landed.**
- Resolve short‑flag collisions:
  - `-a` is `--all` only. `--auth` is long‑only and value is `user:pass` or a token (auto‑detected by `:` presence) — or paired with `--token <bearer>` when the caller already has one.
  - `-r` is `--remote` only. `route --remove` becomes long‑only `--remove`.
  - `-d` is `--dir` (test) only. `--dataType` renames to `--data-type` (kebab) without a short.
  - `-l` is `--locations` (list) only. `logs --list` becomes long‑only `--list`.
  - `-t` short form dropped from `route --type` and `lookup --searchType` (long‑only `--type`, `--search-type`).
  - `-i` aligns on `--replicas` (deploy keeps; `start --instances` renames to `start --replicas`).
  - `-v` retains its dual meaning by scope (top‑level `--version`, subcommands `--verbose`); document explicitly in `cli.js` help.
- Long‑flag casing: every `--camelCaseFlag` → `--kebab-flag`. (Affects `--dataType`, `--searchType`.)
- Group `state`, `lookup`, `route`, `drain` under `yamf registry`. Reserve `yamf gateway` namespace (no subcommands shipped, but the dispatch and help skeleton land now).
- Fold `init --dev` into `yamf dev` (auto‑bootstrap when registry unreachable). `yamf init` is manifest scaffolding only.
- Remove `yamf auth` command. Add `--auth user:pass` and `--token <bearer>` to `call`, `publish`, `request`, and `yamf registry state|lookup` where they made sense; the auth flow exchanges credentials for a token via the configured auth service then attaches `yamf-auth-token`.
- Rewrite the broken / copy‑pasted `--help` blocks (`auth` removed, `dev`, `build`, `clean`, `describe` audited).
- `[D]` While here, extract the `cli.js` switch into a `Map<subcommand, () => import>` and expose `dispatchYamfCli(argv)` for in‑process routing tests. Several follow‑on slices benefit from being able to assert dispatch without `execSync`.
- `[C]` Coverage closures for `commands/logs.js`, `commands/restart.js`, `commands/nodes.js`, `commands/list.js`, `commands/test.js`, `lib/deploy-driver.js`, `lib/pm3.js`, `lib/as-test-runner.js` are written against the renamed shapes.
- **Shipped:** `SUBCOMMAND_HANDLERS` `Map` + exported `dispatchYamfCli(argv)` in `cli.js` (and `packages/cli` entry re-export); `yamf registry …` / `yamf gateway` dispatch; `yamf auth` removed with `--auth` / `--token` threaded to call/publish/request/registry; `auth.js` deleted; init vs dev split per bullets above.

**Slice 8 — `yamf.config.js` schema + example.** ✓ **Landed.**
- Renamed manifest field `services[].replicaKey` → `services[].registeredServiceName`. `loadYamfConfig` normalizes legacy configs (migrates `replicaKey` → `registeredServiceName`, strips `replicaKey`). `deploy-driver` / `planAndApply` use `registeredServiceName || name` for REGISTRY_PULL `replicas[…]` and rolling target resolution (no separate `pm3.js` / `dev.js` call sites).
- Updated `yamf.config.example.js` with `registeredServiceName`, `watch`, and `build.packages`.
- `[B]` `yamf-config-tests.js` covers normalization + discovery; JSDoc on `load-yamf-config.js` matches the example.

**Slice 9 — Smoke / placeholder e2e cleanup (§B walk).** ✓ **Landed.**
- **Auth:** removed trivial `auth-smoke.e2e-tests.js`; added `tests/auth-flow-integration-tests.js` (`authenticate` → `verifyAccess` → `logout` with `useSessions: true`, then assert post‑logout `verifyAccess` fails).
- **Postgres e2e:** second query exercises `:answer` placeholder + snake_case → camelCase row mapping (`raw_snake_value` → `rawSnakeValue`).
- **SQLite:** moved `:memory:` smoke to `sqlite-smoke-integration-tests.js` (removed from e2e bucket).
- **User e2e:** fixed nested `get` response shape; added `invite` → `register` → `get` path when Postgres URL is set.
- **XSS:** renamed to `xss-security-integration-tests.js` (no process boundary).
- **`run-e2e-tests.mjs`:** scans only dirs that still contain `*.e2e-tests.js` (core cases, postgres, user).
- **Smoke examples:** `example-tier-smoke.example.js` allocates an ephemeral TCP port with `node:net` (runs without a local `examples/node_modules`); `case-mapper-smoke.example.js` asserts mapper output; `pm3-smoke.example.js` / `dev-hmr-smoke.example.js` boot registry + service on an ephemeral port (`pickListenPort` when `YAMF_REGISTRY_URL` unset), `envConfig.reloadFromProcessEnv()`, then terminate cleanly.

**Slice 10 — Coverage closures (§C remainder).** ✓ **Landed (medium tier + test conventions).**
- **Registry / gateway `http-route-handler.js`:** missing `HttpError` import fixed (prod/no-match path threw `ReferenceError`). New `http-route-handler-tests.js` covers trailing-slash **301**, local **debug payload**, and production **`HttpError(404)`** for both registry and gateway handlers.
- **`route-registry.js`:** `route-registry-tests.js` — register direct/controller, `findControllerRoute`, unregister validation (**400** empty path, **404** unknown), wildcard unregister.
- **`bundle-store.js`:** `bundle-store-tests.js` — invalid `pathFor`, stream **tmp → rename** on hash match, **hash mismatch** clears `.part` and omits final file.
- **`schema-validation.js`:** `packages/shared/tests/validator-schema-validation-tests.js` — `validateSchema(null)` → `SchemaError`.
- **`terminateAfter` style:** auth/sqlite/postgres user smokes use **`terminateAfter(async function … () { await registryServer(); … })`** where teardown is registry-only; **access-control e2e** keeps multi-arg **`terminateAfter`** with **named function factories** plus **`withEnv` + `pickListenPort`** for isolated registry/gateway ports when `.env.test` ports are busy.
- **CLI §C high-impact coverage:** `cli-commands-coverage-tests.js` exercises **`logs` / `restart` / `list`** (help, `--remote`/`--watch`/`--list` conflicts, `--list` empty/mapping, `pm3.logs`, `--all` restart filter, `--rolling`); **`as-test-runner-tests.js`** covers `globBasenameToRegex`, `discoverAsTestFiles`, **`buildGeneratePayload` / `defaultGenerateOutPath`**, and **`runScriptAsTest`** deadline when the child never opens the assigned registry port; **`deploy-driver-tests.js`** extended with **`mergeRequiredEnvFromProcess`**, **noop `dryRun`**, **missing bundle** error, **`uploadDeployBundleToRegistry`** token guard; **`cli-command-validation-tests.js`** extended for **`yamf test`** (`--generate` requires `--as-test`, `--as-test` requires `-f`, invalid `--timeout`, **`--list --as-test`**).
- Docs: **`docs/TESTING.md`**, **`packages/test/README.md`** updated for the single-fn vs multi-arg split.

**Slice 11 — D residuals.** ✓ **Landed (partial).**
- **`notifyRegistryOfPureService` never throws:** moved `getRegistryConfig()` inside the try block so the function returns `null` when `YAMF_REGISTRY_URL` is unset instead of throwing. Removed the redundant outer `try/catch` from `createPureService` (`create-service.js`) and `createPureSubscriptionService` (`create-subscription-service.js`).
- **Drop `undefined` sentinel in `pureServiceWrapper.before`:** callers must return `Next` explicitly to skip the main handler; implicit `undefined` no longer short-circuits. Makes the pure-service `before` contract match the HTTP service shape.
- **Deploy observability ring buffer:** `createRegistryState()` gains `deployHistory: []`; `handleHealthCheck` exposes it as `deployEvents` in the `HEALTH` response; `registerDeployRouter` pushes each plan decision (service, fromHash, toHash, decision, at, deployer) to the ring (max 20 entries). `yamf status --health` prints the recent deploys table.
- **`yamf status --versions --since <iso>`:** new `--since` flag filters the replica list to entries with `registeredAt ≥ since` (falls back to a "no replicas since…" message when the filter matches nothing). Invalid ISO dates exit 1.
- **`createLocalService` extract / `undefined`-sentinel full cleanup** deferred (the sentinel fix + `notifyRegistry` collapse handles the main footgun; a full lifecycle-dedupe refactor is lower priority post-v1).
- **C6 admin-auth issuer** — deferred.
- **Cross-cut 4/5** (auto re-placement, canary) — deferred.
- **CLI §C additions (landed alongside Slice 11):** `testNodesHelp` + `testNodesMissingRegistryUrl` in `cli-commands-coverage-tests.js`; `testListLiveRegistryNoUrl`; new `pm3-unit-tests.js` (pollDefaults, shouldUseRegistryBroadcastStop, getStopSigtermPollMs, pruneDeadProcesses).

#### A.3 Versioning & migration

The `[1.0.0]` tag in `CHANGELOG.md` represents the public 1.0 cut, but the v1 *freeze* (where backward compatibility becomes a hard contract) is the milestone gated by this section. Slices 1–8 contain breaking renames; slice 9–11 are additive. Two viable release shapes:

- **Single 2.0 cut.** Land slices 1–8 in sequence on a `2.0.0-rc` line, ship one CHANGELOG section enumerating every rename with a sed‑style migration block, tag `2.0.0` once §C high‑impact closures are green. Strict SemVer.
- **Continued 1.x with deprecations.** Land slices 1–8 incrementally with both old + new names live (deprecation warnings on the old names), tag intermediate `1.x.0`s, and remove the old names in a final `2.0.0` cut. Gentler but more code to carry.

Pick at the start of slice 1; default recommendation is the single 2.0 cut since the target audience (v1‑adjacent early consumers) is small and clean breaks beat ambient deprecation chatter.

### B. Smoke / placeholder e2e cleanup

The `*.e2e-tests.js` bucket is currently a mix of useful end‑to‑end checks and `import + assert(svc.name === '…')` placeholders. Audit each file and either grow it into a real e2e or fold its assertion into the package's normal integration suite.

| File | Today | Action |
|------|-------|--------|
| `packages/services/auth/tests/auth-flow-integration-tests.js` | (was trivial e2e smoke.) | **Landed:** full auth + logout integration; e2e file removed. |
| `packages/services/postgres/tests/psql-smoke.e2e-tests.js` | `SELECT 1` + parameterized `:answer` / camelCase mapping when Postgres URL set. | **Landed** (e2e). |
| `packages/services/sqlite/tests/sqlite-smoke-integration-tests.js` | `SELECT 1` against `:memory:`. | **Landed** (integration). |
| `packages/services/user/tests/user-smoke.e2e-tests.js` | `create` + `get`; `invite` + `register` + `get` when URL set. | **Landed** (e2e). |
| `packages/shared/tests/xss-security-integration-tests.js` | `sanitizeHtml` in‑process. | **Landed** (integration; renamed from `xss-integration.e2e-tests.js`). |
| `packages/core/tests/cases/access-control.e2e-tests.js` | Public‑vs‑private gateway access against a real registry + gateway. | Unchanged (kept as e2e). |

Same audit for `*-smoke.example.js` files: each is now a runnable script (good), but a few are essentially "import + log a name". These should either grow a meaningful demo or be deleted; the goal is "every example shows real API usage."

### C. Coverage gaps worth picking up before lockdown

From the latest c8 report. Triage by impact on a v1 consumer reading or relying on the file:

**High impact (touch v1 surface or operator ergonomics):**

- `packages/cli/src/commands/logs.js` — **40%**. ~~Either cover the streaming + filter paths or trim the file~~ — **help / `--list` / `--remote` conflicts / stubbed `pm3.logs` covered** in `cli-commands-coverage-tests.js` (live `--watch` still manual / long-running).
- `packages/cli/src/commands/restart.js` — **60%**. ~~Rolling restart already has integration coverage; non‑rolling and edge flag combinations are the gap~~ — **`--all` vs running-only, `--rolling` + `--remote`/`--all` rejects, stubbed paths** in `cli-commands-coverage-tests.js`.
- `packages/cli/src/commands/nodes.js` — **60%**. `--remote` + URL discovery; share fixtures with `cli-registry-nodes-health-tests.js`. *(Unchanged — existing exec-based tests.)*
- `packages/cli/src/commands/list.js` — **66%**. ~~Empty state, remote pm3 path, JSON output~~ — **help, `-v` log path lines, `--services` view** with stubbed `PM3` in `cli-commands-coverage-tests.js` (live registry section still best covered under integration).
- `packages/cli/src/commands/test.js` — **71%**. ~~The dispatch around `--as-test`, `--generate`, `--include-e2e`, `--timeout`, `--list` has gaps~~ — **Guard rails + `--list --as-test`** in `cli-command-validation-tests.js` + `as-test-runner-tests.js`.
- `packages/cli/src/lib/deploy-driver.js` — **70%**. **`mergeRequiredEnvFromProcess`, noop `dryRun`, missing bundle, upload token** in extended `deploy-driver-tests.js`.
- `packages/cli/src/lib/pm3.js` — **76%**. Internals of broadcast / poll / restart‑rolling. *(Still open beyond stubbed surface.)*
- `packages/cli/src/lib/as-test-runner.js` — **79%**. ~~Timeout + SIGKILL escalation + generate output paths~~ — **glob/discover/generate payload + timeout-or-early-exit path** in `as-test-runner-tests.js` (full SIGKILL escalation remains a rare branch).

**Medium (framework correctness, not on the user‑written hot path):**

- `packages/core/src/api/call-service.js` — **65%**, `create-subscription-service.js` — **67%**. Failure / retry branches and pure‑service variants.
- `packages/core/src/gateway/http-route-handler.js` & `packages/core/src/registry/http-route-handler.js` — **56%** each (same file shape). Error and 4xx paths.
- `packages/core/src/registry/replica-helpers.js` — **69%**. Pure unit branches called out in the original Tier‑C plan.
- `packages/core/src/registry/bundle-store.js` — **50%**. Tmp+rename + dedupe behavior.
- `packages/core/src/registry/route-registry.js` — **74%**. Less critical but small file; cheap to close.
- `packages/services/auth/service.js` — **72%**. `logoutAll`, session‑metadata path, kid mismatch.
- `packages/services/file-server/service.js` — **82%**. SPA fallback + `simpleSecurityCheck` edges.
- `packages/services/file-upload/service.js` — **72%**. Quota / mime sniff / abort paths.
- `packages/services/pm3/service.js` — **59%**. Deploy command + spawn error paths (the integration test covers the happy path).

**Lower (deferrable post‑v1 unless we change the API):**

- `packages/client/src/Element.js` — **60%**, `client-utils.js` — **36%**, `state.js` — **67%**, `dev-hmr.js` — **48%**, `vite-plugin-yamf-dev.js` — **62%**. Browser‑shaped paths; expand only when those modules churn or when an app pulls them into a real e2e.
- `packages/shared/src/security/xss.js` — **83%** + `validator/schema-validation.js` — **70%** + `validator/validate.js` — **77%**. Pure helpers; cover edge branches when adding new validator features.

### D. Misc residuals from the previous plans

Carried over from the deleted test‑plan and v1‑readiness docs; these are still real but small:

- **Optional CLI dispatch refactor** — extract a `Map<subcommand, () => import>` from the giant `switch` in `packages/cli/src/cli.js`, optionally export `dispatchYamfCli(argv)` for routing tests without `execSync`. Low ROI; only worth doing if we add several new subcommands.
- **`createService` / `createSubscriptionService` cleanup** — extract `createLocalService({...})` to dedupe pure/non‑pure lifecycle plumbing; collapse `notifyRegistryOfPureService` silent failures into a single contract; drop the `undefined` sentinel in `pureServiceWrapper`.
- **Deploy observability follow‑up** — registry `/health` deploy ring buffer + `yamf status --versions --since` (cross‑cut 3 residual; `yamf:deploy` pub already shipping).
- **C6 admin‑auth issuer** — separate admin auth service for deploy tokens (vs shared `YAMF_DEPLOY_TOKEN` + HMAC); Tier‑2 ed25519 bundle signing already shipped.
- **Cross‑cut 4 / 5** — auto re‑placement on sustained unhealthy / FLAP and `--canary`. Hooks exist in `deploy-decision.js`; deferred unless product demand surfaces.

---

## Acceptance for the v1 freeze cut

Tag‑stable when **all** of:

- §A API design review PR landed; CHANGELOG documents any rename / deprecation under the next tag.
- §B smoke/e2e audit done — every `*.e2e-tests.js` and `*-smoke.example.js` either earns its tier or is removed.
- §C high‑impact coverage gaps closed (logs / restart / nodes / list / test / deploy-driver / pm3 / as-test-runner). Medium and lower can carry post‑v1.
- `pnpm test`, `pnpm test:integration`, and `pnpm test:e2e` all green on a clean checkout.
- `pnpm run check:metadata` green; root README + per‑package READMEs reflect the post‑review naming.
- CHANGELOG `[Unreleased]` collapsed into the next dated section; version bumps applied.
