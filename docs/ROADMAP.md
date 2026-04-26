# YAMF Roadmap

Living document. Framework‑level plans (YAMF) live here; product roadmaps for specific apps live alongside the app.

**Cross‑repo goals driving the near‑term work:**

- Fully hot‑reloaded development experience — **including when working against remote dev services**.
- Rolling production deployments **with and without k3s**, driven by the framework itself rather than the cluster.
- Keep the framework **system‑agnostic**: k8s, bare‑metal pm3 nodes, and local dev should all share the same primitives.

## Index

- **This doc** — YAMF framework plan: **What shipped** (including orchestrator slice summary), **Active follow‑on** (cross‑cuts, config refinements), **Shipped slice specifications (reference)**, and **Deferred** (horizon).
- **Test coverage follow-up (near-term debt)** — [TEST-PLAN-FOLLOW-UP.md](./TEST-PLAN-FOLLOW-UP.md): optional tests and coverage not covered by the main gap plan (e.g. `replica-helpers`, browser-only `patch-dom` paths, gateway e2e SSR). **Earlier than horizon** R&D; pick up alongside related slices.
- **SoundClone product roadmaps** (under `soundclone-deployment/docs/`):
  - [Immediate & near‑term (alpha → ~6 months)](../../soundclone-deployment/docs/ROADMAP-IMMEDIATE-NEAR-TERM.md)
  - [Cloud‑hosted & community release (~6 months → later)](../../soundclone-deployment/docs/ROADMAP-CLOUD-HOSTED.md)
  - [Reliable background playback / HLS design notes](../../soundclone-deployment/docs/ROADMAP-BACKGROUND-PLAYBACK-HLS.md)
- **Shared session backing and ZD** — [Shared session store and zero-downtime rollouts](#shared-session-store-and-zero-downtime-rollouts-operational) — **concrete** config and ops items first; **tentative** ideas at the end.

---

## Shared session store and zero-downtime rollouts (operational)

*Portable server-side session state (e.g. refresh material in `@yamf/services-auth`’s per-token cache keys) and **true** zero-downtime deploys are related but not the same. A **shared** cache/DB makes new replicas see the same session rows as old ones; **rolling placement, health, and draining** (slices C4/C5, existing registry/gateway work) are still required to avoid cutting traffic during a version change.*

### Immediate / concrete

- **Point auth (and any other service) at a real shared store in non-dev** — Same client API as today (`@yamf/services-cache` / Keyv-style), but **not** only in-process memory on a single service instance: Redis, a dedicated YAMF cache service replica set, or another cluster-visible cache. This is the prerequisite for “replace one auth pod without logging everyone out.”
- **Deploy configuration, not bundle contents** — Cache URL, credentials, and TLS live in the **config overlay** (cross-cut 1 / `config-service` story) so the same content hash can run against different cache endpoints.
- **Harden the cache like a datastore** — TLS in transit, authentication to the cache, namespaced keys, eviction/TTL policy aligned with access/refresh lifetimes. Session-shaped values are secrets.
- **SLO the cache tier** — For production, avoid a single in-memory cache process with no persistence if losing it is unacceptable; **replication and/or persistence** (managed Redis, etc.) per your availability target.
- **At least one replacement strategy that preserves traffic** — e.g. **two or more** healthy app instances, or **blue/green** with a cutover, plus **readiness** before a replica receives work; pair with the existing **drain** / `HEALTH` / k3s rolling story already sketched in *What shipped* and Phase 3.
- **Cross-check** the *Cross-cut 6* dev/prod parity checklist (later in this file) before remote deploy (C3+): the **same** `planAndApply` / service wiring should be able to point at shared cache in prod with only config deltas.

### Near-term (pairs with framework rollout slices)

- **C4 / C5 and cross-cut 2 (contract-aware rolling)** — Hash-same scale vs hash-different rollout; version skew rules so old and new binaries can run **during** the roll. Shared sessions **reduce** the “sticky server memory” failure mode; they do **not** remove the need for compatible APIs and data migrations (expand/contract).
- **Long-lived connections** — SSE, WebSockets, and long HTTP work: **drain** old replicas; clients **reconnect** to new ones. (D2/D4 and client HMR are **dev** UX; production ZD is drain + reconnect + shared auth state as needed.)
- **Product apps** (e.g. SoundClone) — Ensure session/logout/401 handling stays correct when **any** replica can serve a request; see product roadmaps under `soundclone-deployment/docs/`.

### Tentative / flesh out later

- **“Dump state to cache on rollout”** and similar R&D — High plumbing; prefer **authoritative shared session store** and normal rolling over bespoke snapshot machinery unless a clear SLO needs it.
- **Distributed YAMF cache service replicas (shared cluster state)** — **Today, multiple cache service replicas do not share state**; each is an isolated in-memory (or local) view. Flesh out later: a real **distributed** mode (e.g. shard-by-key + routing, or a small coordination layer) vs documenting that **production** should point at an **external** shared store (Redis, etc.) and treat YAMF’s cache as dev/single-node. Both paths support the shared-session / ZD story; the trade-off is operability vs framework-in-the-box.
- **Data-backed cache service (Postgres / SQLite optional sync)** — Optional configuration to **persist** or **replicate** the logical keyspace to **Postgres** or **SQLite** (write-through, periodic snapshot, or WAL-style) so restarts, single-replica blips, or audit/debug needs do not require a separate Redis operator skillset. Tension: cache semantics (TTL, eviction) vs **durability** guarantees and write amplification — needs a crisp contract (what is *cache* vs *source of truth*) before shipping.
- **Sticky sessions (L7)** — Only if the app **cannot** be made to work with shared server-side state or stateless per-request identity; prefer shared store + stateless access tokens first.
- **Cross-cut 5 (canary / percentage)** — Replicas + promote/drain; decision hooks exist in `deploy-decision.js`; not required for a first “two replicas + rolling + shared cache” story.
- **D4 `applyPatch` / `createYamfDevHmrSpaPatch`** — Preserves in-tab on Vite-originated dev reload; **yamf dev** deploy still full-reload; orthogonal to **server** zero-downtime.

---

## Test coverage follow-up (near-term)

The [under-50% gap plan](./TEST-PLAN-UNDER-50.md) and the first passes on CLI, `@yamf/client`, and `@yamf/services-dev-hmr` are **not** meant to exhaust every surface. Consolidated **remaining** test work (core helpers, optional CLI dispatch refactor, browser/e2e client paths, optional dev-hmr assertions) lives in **[TEST-PLAN-FOLLOW-UP.md](./TEST-PLAN-FOLLOW-UP.md)**. Track it as **near-term debt** before long-horizon items in the Deferred section below.

---

## What shipped (YAMF)

Rolling k3s support plus the first wave of follow‑on slices. Concretely:

- **Soundclone parity**: `@yamf/services-cache@0.1.4` (fixed bound `del`) and `@yamf/services-user@0.2.1` (invite `expiresIn`, defensive `registerWithToken`, hardened `isTokenExpired`, opt‑in PostGIS geography writes).
- **Auth keypair persistence**: `createAuthService` accepts `keyDir` / env overrides / `ephemeral` and persists ed25519 keypairs under `${YAMF_HOME}/auth/`. Tokens include `kid`.
- **Multi‑session auth**: per‑token cache entries (`refresh:${tokenId}`, `access:${tokenId}`), `maxSessionsPerUser`, `sessionMetadataFn`, configurable access/refresh expiries. `logoutAll` supported.
- **CLI `restart` count fix** and `pollUntilNoNewServices` no longer gated by `lastLength > 0`. PM3 env tunables exposed.
- **Centralized lifecycle**: `process-lifecycle.js` owns the single `SIGTERM`/`SIGINT` pair. Services register via `lifecycle.registerTerminable(fn, { priority })`. Registry/gateway drain last (priority `0`), services drain first (priority `10`).
- **Registry‑initiated `SERVICE_SHUTDOWN`**: `broadcastShutdown` fans out `SERVICE_SHUTDOWN` (registry token validated on the service side) before the registry closes its HTTP server.
- **Dual‑registry drain handshake**: `REGISTRY_DRAIN` between peers via `YAMF_REGISTRY_URL`. Draining registry rejects `SERVICE_SETUP` / `SERVICE_REGISTER` with `503 Retry-After` while continuing to serve `SERVICE_CALL`, `SERVICE_LOOKUP`, `SERVICE_UNREGISTER`, `REGISTRY_PULL`, `HEALTH`, and pub/sub. `HEALTH` now reports `draining: boolean`.
- **Gateway startup readiness gate**: gateway polls registry `HEALTH` and only pulls full state from a non‑draining peer. A fresh registry pings the preregistered gateway on startup to force an immediate re‑pull (closes the k3s DNS‑race window).
- **CLI polish**: `yamf restart --rolling <target>`, `yamf drain`, `yamf status --health`.
- **k3s manifest**: rolling strategy with `maxUnavailable: 0 / maxSurge: 1`, `terminationGracePeriodSeconds: 30`, auth key volume mounted at `/app/.yamf`.
- **File server first‑class SPA mode + segment‑based security** (slice 1). `createStaticFileService({ spa: { entry, excludePrefixes, excludeExtensions } })`; `simpleSecurityCheck` matches system dirs by whole path segment.
- **SSE / subscription channel handlers get `this === context`** (slice 2). Channel handlers, `onConnect`, and `onDisconnect` can `await this.call(...)` and stay cache‑aware across late peer registrations.
- **Interactive SSR of client events** (slice 3). Render‑context isolation, signed‑handler RPC (`SSR_INVOKE_HANDLER`), `@yamf/client/ssr-render`, `@yamf/client/ssr-hydrate`, and `server.broadcastRender(element, { target })` on SSE services with `renderMode: 'html-handlers'`.
- **Soundclone migration** (slice 4). Dropped `spaFallbackResolver` + `spaStaticFileSecurityCheck` and replaced `track-events-sse.js` / `track-events-sub` with `createEventSourceService('track-events', { onConnect, channels })`. Wire protocol unchanged.

**Orchestrator, deploy, and hardening (former phases 1–3 and most of phase 4 — D4: `createYamfDevHmrSpaPatch` + SoundClone; other apps / slice‑3 SSR still on them).**

- **E — Coalesced / bulk cache updates.** `packages/core/src/registry/pubsub-manager.js` + `cache-handler.js` bulk path; `YAMF_CACHE_COALESCE_MS` (default `0` preserves legacy sync push; set `> 0` in prod to enable), `YAMF_CACHE_COALESCE_MAX_MS`, `YAMF_CACHE_BULK_MAX`, `YAMF_CACHE_PUSH_STALE_AFTER`. Subscribers default `metadata.cacheBulk: true`. Tests: `cache-coalesce-tests.js`.
- **F — `registerCommand`.** `packages/core/src/registry/command-router.js`; `registryServer` exposes `server.registerCommand`; first consumer `packages/services/deploy-router`. Tests: `register-command-tests.js`.
- **A — CSP / default security headers.** `packages/core/src/shared/csp.js` (`buildCsp`, `getDefaultResponseSecurityHeaders`); `YAMF_CSP_MODE`, `YAMF_CSP_RELAXED`, etc. Tests: `security-headers-tests.js`.
- **B — Upload & path safety.** `packages/shared/src/path-safety.js` and tightened file-upload / file-server behavior (see package changelogs for details).
- **C1 / C2 / cross‑cut 1 (v1).** `yamf build`, bundle cache, `yamf deploy --local`, `planAndApply`, `@yamf/services-config` and CLI `yamf config` (refinements remain — see *Active follow‑on*).
- **D1** — `yamf dev` (watch + rebuild + deploy); `packages/cli/src/commands/dev.js`, `load-yamf-config` watch entries.
- **C3** — `yamf deploy --remote`, registry bundle store, `streamBundleToFileWithHashCheck`, `remote-pm3-adapter` / `createRemotePm3`.
- **C4 / C5** — per-replica `sourceHash` / `configVersion` / `node` in `replicaMetadata`, `deployDecisionFromReplicas`, `yamf deploy --rollback`, multi-node `pickNode` in deploy-router, rolling via existing driver + pm3.
- **Cross‑cut 3 (baseline).** `publishMessage('yamf:deploy', …)` from deploy-router on plan paths (`packages/services/deploy-router/service.js`); richer registry `/health` deploy ring buffer called out in the design doc is optional follow‑up.
- **D2 / D3** — `@yamf/services-dev-hmr`, `yamf dev` publish, `@yamf/client/dev-hmr`, Vite `yamfVitePluginDev`.
- **C6 (Tier 2 / registry).** `authorized_keys` + `yamf-bundle-ed25519-sig` enforcement and CLI `YAMF_DEPLOY_PRIVATE_KEY` upload signing. **Not shipped:** separate admin-only auth issuer (still noted in *Active follow‑on*’s small-print).

**Still intentionally narrow / follow‑up (not a separate phase list):** cross‑cut **2** (full contract diff / `yamf deploy --dry-run` / registry gate) as sketched in this file is only partially realized — contract data is on the wire; **automated** incompatible blocking is not the focus of the shipped path. **Cross‑cuts 4 and 5** (auto re-placement, canary) remain deferred (see *Active follow‑on*).

Regression coverage lives in `packages/core/tests/cases/rolling-registry-tests.js`, `packages/core/tests/cases/ssr-handler-tests.js`, and `packages/cli/src/tests/cli-rolling-commands.js`, plus `cache-coalesce-tests.js`, `register-command-tests.js`, and deploy driver tests.

### Relevant env knobs

| Env var | Default | Meaning |
|---|---|---|
| `YAMF_GRACEFUL_SHUTDOWN_MS` | `15000` | Lifecycle timeout per terminable. |
| `YAMF_DRAIN_MS` | `3000` | Drain grace a registry advertises via `Retry-After` on 503. |
| `YAMF_SHUTDOWN_BROADCAST_TIMEOUT_MS` | `2000` | Per‑service wait for `SERVICE_SHUTDOWN`. |
| `YAMF_REGISTRY_DRAIN_HANDSHAKE_MS` | `8000` | Startup handshake timeout to an existing peer. |
| `YAMF_GATEWAY_READY_WAIT_MS` | `10000` | Gateway's initial wait for a non‑draining registry. |
| `YAMF_GATEWAY_READY_POLL_MS` | `250` | Gateway's health‑poll interval during startup. |
| `YAMF_REGISTRATION_RETRY_LIMIT` | `120` | Service registration retries (bridges a registry gap). |
| `YAMF_RETRY_DELAY` | `100` | Initial backoff for retrying registrations. |
| `YAMF_PM3_POLL_MAX_ATTEMPTS` | `150` | CLI `pm3` startup polling cap. |
| `YAMF_PM3_POLL_INTERVAL_MS` | `200` | CLI `pm3` startup polling interval. |
| `YAMF_PM3_POLL_STABLE_CHECKS` | `3` | Consecutive stable snapshots before declaring ready. |
| `YAMF_SSR_HANDLER_TTL_MS` | `600000` | Lifetime of a signed SSR handler id. |
| `YAMF_SSR_HANDLER_MAX` | `10000` | Max live SSR handlers before LRU eviction. |
| `YAMF_SSR_HANDLER_SWEEP_MS` | `60000` | SSR handler TTL sweep interval. |
| `YAMF_CACHE_COALESCE_MS` | `0` | `0` = legacy synchronous cache push per update; set `> 0` to enable coalescing (see *What shipped* — slice E). |
| `YAMF_CACHE_COALESCE_MAX_MS` | `250` | Max window from first queued update when coalescing is on. |
| `YAMF_CACHE_BULK_MAX` | `500` | Flush immediately if a subscriber’s pending list reaches this size. |
| `YAMF_CACHE_PUSH_STALE_AFTER` | `3` | Failed coalesce windows before a subscriber is marked stale. |

---

## Active follow‑on work (framework)

The former **Phase 1–3** and **most of Phase 4** workstreams are **shipped** and summarized under *What shipped* above. What follows is **remaining** or **optional** work — not a phased ladder.

**D4 (done for SPA + SoundClone):** `createYamfDevHmrSpaPatch` in `@yamf/client/dev-hmr` (tests: `yamf test -d . -f dev-hmr` in `packages/client`); other apps and **slice 3** HTML/SSR UIs follow the same `applyPatch` contract manually — [D4-SPA-HMR-ANALYSIS.md](./D4-SPA-HMR-ANALYSIS.md).

### Cross‑cut 1 — config-service refinements (before treating remote as “boring”)

- Atomic `save()` (tmp + rename) in `packages/services/config/storage.js`.
- Random per‑install salt instead of hard‑coded `KEY_SALT` for `YAMF_CONFIG_KEY` derivation.
- Passphrase entropy hint (`openssl rand -base64 32`).
- Optional: `yamf config` / config-service `delete` for key rotation by removal.

### Cross‑cut 2 — contract‑aware rolling (full design)

- `yamf deploy --dry-run` contract diff, `--allow-breaking`, registry **promotion** gate on backward compatibility (see the sketch under *C3+ deploy router* in this file). **Today:** contracts ride on `REGISTRY_PULL`; **automated** enforcement is not fully wired.

### Cross‑cut 3 — deploy observability (residual)

- Richer **registry** `/health` deploy ring buffer and `yamf status --versions --since` as in the C3+ sketch — `yamf:deploy` pub is already in place for subscribers.

### Cross‑cut 4 / 5 — placement automation & canary

- **4** — Auto re‑placement on sustained unhealthy / FLAP; needs signals from pm3 or registry.
- **5** — `yamf deploy --canary` / percentage; `deploy-decision.js` is the intended hook.

### C6 / deploy auth — smaller items

- Separate **admin** auth issuer for deploy (vs shared `YAMF_DEPLOY_TOKEN` + HMAC).
- `requireDeployToken` is implemented on plugin commands; any remaining `DEPLOY_TOKEN` gating for **browser** `EventSource` (D2) and **gateway URL** docs for Vite (D3) are polish.

### Cross‑cut 6 — dev/prod parity (ongoing)

- **Manual** checklist in this file under *Cross-cut 6* before expanding remote or dev ergonomics. `planAndApply` is the shared deploy entry point for local/remote.

---

## Shipped slice specifications (reference)

Design notes below were written as **pre‑ship** checklists. **E, F, A, B, C1, C2, C3, C4, C5, D1–D3, C6 (Tier 2),** and the baseline **E + cache** path are in tree; the sections remain as **API and semantics** reference.

### Slice E — Coalesced bulk cache updates  `[shipped — reference]`

**Goal.** Replace the "one HTTP call per subscriber per registration" fanout with "one HTTP call per subscriber per coalesce window, carrying N updates". Directly addresses the update‑fanout bottleneck identified in the Scale envelope below, without changing any subscriber‑visible semantics beyond a small latency shift and an optional bulk wire shape.

**Why it mattered (historical).** It was the cheapest scalability win: `pubsub-manager.js` + `cache-handler.js`, zero topology change. Coalescing is **off** by default (`YAMF_CACHE_COALESCE_MS=0`) for backward compatibility; set a positive window in production.

**Design commitments:**

1. **Buffered dispatch.** `publishCacheUpdate` stops firing HTTP calls inline. Instead it appends `{ subscription, service, location, contract }` to a per‑subscriber pending list and arms (or resets) a debounce timer.
2. **Debounce semantics.**
   - `YAMF_CACHE_COALESCE_MS` (default `0` in code = coalescing off; e.g. `50` in prod): flush this many ms after the **last** queued update.
   - `YAMF_CACHE_COALESCE_MAX_MS` (default `250`): hard ceiling from the **first** queued update in a window, so sustained streams still flush.
   - `YAMF_CACHE_BULK_MAX` (default `500`): if a subscriber's pending list reaches this, flush immediately.
3. **Wire protocol.** Current `buildCacheUpdateHeaders` path keeps working (single‑update, header‑only body). A new `yamf-cache-bulk: 1` mode sends a body `{ windowId, updates: [{ subscription, service, location, contract }] }` and a single header. `windowId` is `${registryId}:${monotonicCounter}` — used today only for dedup/logging, but a deliberate forward‑compat hook so the cascade fan‑out horizon item (Deferred) can reuse the exact wire shape without another protocol bump. Subscribers advertise support via `metadata.cacheBulk: true` at registration; registry falls back to per‑update calls for legacy subscribers within the same window.
4. **Per‑subscriber failure isolation.** A failing subscriber doesn't drop the whole window; it's retried once on the next tick with exponential backoff. After `N` consecutive failed windows (default `3`), the registry marks the subscriber stale and relies on its next `REGISTRY_PULL` (triggered on any cache miss) to resync.
5. **Shutdown flush.** Registry's `registerTerminable` hook drains pending windows before closing HTTP. No silently dropped updates during rolling registry restarts.
6. **No ordering guarantees beyond "cache converges".** The same update can appear in multiple coalesce windows across restarts; service‑side `updateCacheEntry` is already idempotent by `(service, location)`.
7. **Tests** — `packages/core/tests/cases/cache-coalesce-tests.js`:
   - Deploy storm: 100 registrations within 10 ms → 1 outbound call per subscriber, 100 updates in payload.
   - Latency cap: continuous 1 registration/10 ms → flushes at `COALESCE_MAX_MS`, not starved.
   - Mixed subscribers: one bulk‑capable, one legacy → both converge to the same final cache state.
   - Registry shutdown with pending updates → all delivered (or subscriber gets stale mark) before `httpServer.close` resolves.

**Version bumps.** `@yamf/core` minor bump (new env knobs, new optional wire mode, backward compatible).

**Expected reduction.** N registrations × M subscribers (today) → ~1 call × M subscribers per coalesce window (after E). For a 100‑service rolling redeploy against ~100 subscribers: ~10 000 calls → ~100 calls per window (with ≤250 ms worst‑case update latency). That's the "tunable, no arch change" row of the Scale envelope moving from tight to comfortable.

### Slice F — Registry command extension point  `[shipped — reference]`

**Goal.** Expose `registry.registerCommand(name, handler)` on the command router so plugin services can add new `yamf-command:` verbs **without editing core**. Formalizes the "tiny kernel, everything else is a plugin" positioning in [Towards 1.0](#towards-10) and — critically — lets slice C's deploy router ship as `@yamf/services-deploy-router` rather than as a new `packages/core/src/registry/deploy-router.js`. Without F, slice C forces a last‑minute API‑shape argument during C3.

**Design commitments:**

1. **API.** Single new function exported from `packages/core/src/registry/command-router.js`:
   ```js
   registry.registerCommand(name, handler)
   // name: unique yamf-command verb, e.g. 'SERVICE_DEPLOY_PLAN'
   // handler: async ({ headers, body, requesterLocation }) => { status, body, headers? }
   ```
2. **Auth.** Handlers receive request context only **after** the outer router has verified `YAMF_REGISTRY_TOKEN` (or whatever token class the command opts into via a registration option). Plugins cannot override base token verification.
3. **Name collisions.** Built‑in commands (`SERVICE_REGISTER`, `SERVICE_CALL`, `REGISTRY_PULL`, `SERVICE_SHUTDOWN`, `REGISTRY_DRAIN`, `HEALTH`, …) are reserved; `registerCommand` throws on duplicate registration. `unregisterCommand(name)` exposed for tests and orderly plugin teardown.
4. **Lifecycle.** Commands registered by a service are auto‑cleared when that service unregisters, so stale handlers never outlive their owner. Needed because a deploy router going down shouldn't leave `SERVICE_DEPLOY_PLAN` in a half‑working state.
5. **First consumer.** Slice C's deploy router moves to `packages/services/deploy-router/`, calling `registerCommand('SERVICE_DEPLOY_PLAN', ...)` and `registerCommand('SERVICE_DEPLOY_BUNDLE', ...)` at startup. C's sub‑slicing is otherwise unchanged.
6. **Tests.** `packages/core/tests/cases/register-command-tests.js` — basic routing, duplicate rejection, unregister on service loss, reserved‑name rejection, auth pass‑through.

**Version bumps.** `@yamf/core` minor bump (new exported API, backward compatible).

**Remote scope.** F is in-process only (`server.registerCommand` on the registry instance). Slice C3’s deploy router either runs in-process beside the registry (e.g. homelab), or a later follow-up adds a remote `REGISTRY_COMMAND_REGISTER` (or equivalent) command envelope; choose before C3.

### Slice A — Content‑Security‑Policy & default security headers  `[shipped — reference]`

**Goal.** Give YAMF services sane default response headers (CSP + friends) and a minimal, declarative way to tighten them per service or route. Remove the need for apps to hand‑set `x-content-type-options`, `x-frame-options`, etc. on each response.

**Why now.** Slice 3 already sets a few hardening headers on the SSR invoke response (`packages/core/src/api/create-event-source-service.js` lines 163‑175); generalize and broaden.

**Design commitments:**

1. **Default headers applied by `http-server.js`** (or an outer middleware installed by `createService` / `createStaticFileService` / `createEventSourceService`):
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY` (overridable per route)
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: interest-cohort=(), browsing-topics=()` (starter deny list)
   - `Strict-Transport-Security: max-age=31536000` (only when `YAMF_HSTS=on`, opt‑in for non‑TLS local dev)
2. **CSP builder** in `packages/core/src/shared/csp.js`:
   - `buildCsp({ defaultSrc, scriptSrc, styleSrc, connectSrc, imgSrc, mediaSrc, frameAncestors, reportTo, reportOnly })`
   - Default `default-src 'self'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`.
   - `connect-src` automatically includes the service's own origin **plus** registry / gateway URLs it was given at boot (envConfig `YAMF_REGISTRY_URL`, `YAMF_GATEWAY_URL`) so pub/sub and service calls work.
3. **Per‑service / per‑route override.** `createService(handler, { csp })` and `createStaticFileService({ csp })`. `null` keeps default, `false` disables, object merges.
4. **YAMF client compatibility.** Today `renderListeners` (slice 3, `packages/client/src/Element.js`) emits inline `onclick="..."`. Under strict CSP, inline handlers break. Two supported modes:
   - **`unsafe-inline` dev mode** (existing behavior) — default `script-src 'self' 'unsafe-inline'` only when `YAMF_CSP_RELAXED=on`.
   - **Nonce mode** (default in prod) — the SSR path injects a per‑response nonce; `ssr-render` mints `onclick` / `onchange` attributes routed through a **single** bootstrap `<script nonce="...">` that installs delegated listeners (effectively moving listener wiring into one nonced script). This is a small edit to `packages/client/src/ssr-hydrate.js`; hand‑off already flows through `yamf.invoke(...)`.
5. **Headers for SSE.** Preserve `Cache-Control: no-cache` + `Connection: keep-alive`; add `X-Accel-Buffering: no` (already set); confirm `Content-Type: text/event-stream` and `X-Content-Type-Options: nosniff`.
6. **Env knobs.**
   - `YAMF_CSP_MODE=strict|relaxed|off` (default `strict` in prod, `relaxed` in dev).
   - `YAMF_HSTS=on|off`.
   - `YAMF_CSP_REPORT_URI` optional.
7. **Tests.** `packages/core/tests/cases/security-headers-tests.js` — default, overrides, nonce propagation to slice‑3 SSR.

**Version bumps.** `@yamf/core` 0.6.0 → 0.7.0 (new public CSP options); `@yamf/client` 0.2.0 → 0.3.0 if nonce wiring ships with it.

### Slice B — Enhanced upload & path protection  `[shipped — reference]`

**Goal.** Tighten the `file-upload` and `file-server` packages so apps get safe defaults for untrusted input without each writing their own `spaStaticFileSecurityCheck`‑style shims.

**Design commitments:**

1. **Filename sanitization** (upload pipeline, shared helper in `packages/shared/src/path-safety.js`):
   - Strip path separators, null bytes, control chars (`\x00‑\x1f\x7f`), leading `.`, and Unicode bidi overrides; normalize NFC; collapse runs of dots.
   - Cap length (default 160 bytes UTF‑8).
2. **Content‑type validation by magic bytes.** `packages/services/file-upload` takes a new `acceptMime` allow‑list and uses a small sniffer (first 32 bytes → mime) rather than trusting the client `Content-Type`. Reject on mismatch with `415`.
3. **Size limits.** `maxBytes` per service, default `25 MiB`; registry‑wide cap `YAMF_UPLOAD_MAX_BYTES`. Reads early‑abort streaming when exceeded.
4. **Per‑user quota hook.** `onAllocate({ userId, bytes })` → returns allow/deny + current usage. Optional `quota-service` stub in `packages/services/` for apps that want a drop‑in (postgres/sqlite backed).
5. **Path protection for `file-server`:**
   - Canonicalize (`path.resolve`) the final on‑disk path and assert `startsWith(rootDir + path.sep)` after all mapping.
   - `simpleSecurityCheck` already blocks `%2e`, `..`, backslash; add explicit null‑byte and control‑char checks.
   - Optional `scopedByUser: { segment: 'u', authService: 'auth-service' }` — if `/u/<id>/...` is hit and the segment doesn't match the authenticated `userId`, return 403 (no need for apps to implement this themselves).
6. **Audit log.** `publishMessage('yamf:upload', { userId, service, bytes, mime, hash, ip })` — apps can subscribe for rate limiting / abuse signals.

**Version bumps.** `@yamf/services-file-upload` 0.1.5 → 0.2.0; `@yamf/services-file-server` 0.2.0 → 0.3.0; `@yamf/shared` 0.1.2 → 0.2.0 (new `path-safety` export).

### Phase 2 implementation details  `[shipped — reference, C1/C2 / cross-cut 1]`

Consolidated snippets and contracts for the **C1 / C2 / config** work (now shipped). Kept for implementers and parity reviews (cross‑cut 6).

#### `yamf.config.js` — project manifest (C1, reused by C2 and D1)

New top‑level file discovered by the CLI (Node ESM, exported default). Minimum viable shape:

```js
// yamf.config.js
export default {
  root: '.',
  services: [
    { name: 'registry',         entry: 'src/registry.js',          replicas: 1, internal: true },
    { name: 'auth-service',     entry: 'src/services/auth.js',     replicas: 1, env: ['ADMIN_USER', 'ADMIN_PASS'] },
    { name: 'track-service',    entry: 'src/services/tracks.js',   replicas: 2, env: ['DB_URL'] }
  ],
  build: {
    external: ['@yamf/*'],       // merged with CLI defaults
    target:  'node20',
    sourcemap: true
  }
}
```

- `env: [...]` lists **names** of required env vars, not values. Values come from cross‑cut 1's config‑service (or `process.env` locally). The build reads names only; it must never read values to keep bundles secret‑free.
- `internal: true` skips the service from `--all`/`--only-changed` (registry etc. are managed separately).
- CLI falls back to `--service <entry>` flags for bare repos without a manifest.

#### Bundle cache layout (C1)

```
<repo>/.yamf/build/
  <service-name>/
    <sha256>.mjs
    <sha256>.meta.json        // { entry, env, deps, nodeTarget, createdAt, builderVersion }
    latest.json               // { hash, createdAt } — updated atomically on successful build
  index.json                  // { services: { <name>: <hash> }, updatedAt }
```

- `latest.json` is a **pointer**; bundles are never deleted on rebuild — older hashes stay so C5's `yamf deploy --rollback <hash>` can find them.
- **GC.** `yamf build --prune [--keep N]` (default N=5) walks each service dir, sorts by `createdAt`, removes all but the newest N hashes. Never prunes a hash currently registered on any replica (read from `REGISTRY_PULL` + `replicaMetadata`).
- **Hash recipe (deterministic across machines):**

  ```js
  // packages/cli/src/lib/bundle-hash.js (new)
  export function computeBundleHash(bundleBytes, meta) {
    const normalized = {
      entry: meta.entry,
      env: [...(meta.env || [])].sort(),
      deps: Object.fromEntries(Object.entries(meta.deps || {}).sort()),
      nodeTarget: meta.nodeTarget,
      builderVersion: meta.builderVersion
    }
    const h = createHash('sha256')
    h.update(bundleBytes)
    h.update('\0')
    h.update(JSON.stringify(normalized))
    return `sha256-${h.digest('hex')}`
  }
  ```

  `meta.deps` comes from esbuild's `metafile.inputs` (path → sha256 of file content) — this makes the hash stable across machines because it hashes source content, not absolute paths.

- **esbuild call:**

  ```js
  // packages/cli/src/commands/build.js (new)
  const result = await esbuild.build({
    entryPoints: [svc.entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: cfg.build.target || 'node20',
    sourcemap: cfg.build.sourcemap !== false,
    external: [...(cfg.build.external || []), '@yamf/*'],
    write: false,
    metafile: true,
    absWorkingDir: resolve(cfg.root || '.')
  })
  const bytes = result.outputFiles[0].contents
  const hash  = computeBundleHash(bytes, { entry: svc.entry, env: svc.env, deps: hashInputs(result.metafile.inputs), nodeTarget: cfg.build.target, builderVersion: BUILDER_VERSION })
  ```

#### Per‑replica metadata in the registry — **C2 prerequisite**

Today `serviceMetadata` is keyed by **service name**; slice E's merge makes "last registration wins". For C2 to route `scale` vs `rolling`, the registry must track `sourceHash` **per replica**. Minimal change:

```js
// packages/core/src/registry/registry-state.js
export function createRegistryState() {
  return {
    // ... existing ...
    replicaMetadata: new Map()       // `${service}\0${location}` → { sourceHash, registeredAt, pid? }
  }
}
```

- `registerService(state, service, location, { metadata })` additionally does:

  ```js
  if (metadata?.sourceHash) {
    state.replicaMetadata.set(`${service}\0${location}`, {
      sourceHash: metadata.sourceHash,
      registeredAt: Date.now()
    })
  }
  ```

- `unregisterService` clears the matching key.
- `REGISTRY_PULL` response grows a `replicas` block (backward‑compatible; existing consumers ignore):

  ```jsonc
  {
    "services": { "track-service": ["http://10.0.0.4:23010", "http://10.0.0.5:23010"] },
    "replicas": {
      "track-service": [
        { "location": "http://10.0.0.4:23010", "sourceHash": "sha256-abc…", "registeredAt": 1713… },
        { "location": "http://10.0.0.5:23010", "sourceHash": "sha256-abc…", "registeredAt": 1713… }
      ]
    }
  }
  ```

- Per‑replica metadata is **not** broadcast via cache updates — subscribers don't need it. It's a registry‑internal index for the deploy path.

#### `YAMF_SOURCE_HASH` propagation (C2, small diff)

```js
// packages/core/src/api/service-helpers.js
// inside registerServiceWithRegistry, before buildRegisterHeaders
const sourceHash = envConfig.get('YAMF_SOURCE_HASH', null)
if (sourceHash) {
  metadata = { ...(metadata || {}), sourceHash }
}
```

That's the entire client‑side change. Every service spawned by `yamf deploy` inherits `YAMF_SOURCE_HASH`; legacy services (no env var) register with no `sourceHash` and are treated as `none` by the decision table — the upgrade path is "redeploy once".

#### C2 deploy driver — decision table lives in the CLI

```js
// packages/cli/src/lib/deploy-driver.js (new; shared by --local today, --remote later)
export async function planAndApply({ target, registryUrl, service, hash, bundlePath, replicas, pm3 }) {
  const pull = await httpRequest(registryUrl, { headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL } })
  const current = (pull.replicas?.[service.name] || [])
  const sameHash = current.filter(r => r.sourceHash === hash)
  const otherHash = current.filter(r => r.sourceHash && r.sourceHash !== hash)

  const decision =
    current.length === 0                              ? 'rollout'
    : otherHash.length > 0                            ? 'rolling'
    : sameHash.length < (replicas ?? 1)               ? 'scale'
    :                                                   'noop'

  if (decision === 'noop') return { decision, replicas: sameHash.length }

  const env = { YAMF_SOURCE_HASH: hash, YAMF_BUNDLE_PATH: bundlePath }

  if (decision === 'rollout' || decision === 'scale') {
    const want = (replicas ?? 1) - sameHash.length
    for (let i = 0; i < want; i++) await pm3.start(bundlePath, { env })
    return { decision, added: want }
  }

  // rolling: restartRolling with new env, one replica at a time, drain each.
  // pm3.restartRolling already spawns-then-stops; we only need it to carry env through.
  const result = await pm3.restartRolling(service.name, { env })
  return { decision, replaced: result.replaced.length }
}
```

- **One blocker:** `pm3.restartRolling(target, options)` currently accepts `options` but doesn't forward `options.env` into the inner `this.start(entry.filepath, { internal, ...options })` in a way that merges correctly — double‑check the call site in `packages/cli/src/lib/pm3.js:482`; a `{ env: { ...options.env } }` explicit forward is cleanest and avoids `internal: wasInternal` being shadowed by a stray `internal: undefined` from the options spread.
- `bundlePath` points at `.yamf/build/<service>/<hash>.mjs`. For C2 that's the file pm3 spawns. For C3 the registry copies bytes to remote pm3 nodes under the same path convention.
- Decision logic is **identical** for `--local` and `--remote`; only the `pm3` object and fetch target differ. That's how cross‑cut 6 (parity) falls out naturally.

#### Cross‑cut 1 — `config-service` scaffolding (hard gate on C3)

Minimum viable contract so C3 can't leak secrets into bundles:

- **Service**: `packages/services/config/service.js` — `createService('config-service', handler)` with commands:
  - `get`  → `{ service, env }` → `{ values: {...}, version: N }`
  - `set`  → `{ service, env, values: {KEY: VALUE}, expectedVersion? }` → `{ version: N+1 }` (admin token required)
  - `list` → `{ service?, env? }` → `[{ service, env, version, keys }]` (no values)
- **Storage**: file‑backed at `${YAMF_HOME}/config/<service>/<env>.enc`, encrypted with libsodium secretbox using `YAMF_CONFIG_KEY` (32‑byte master key persisted like auth's ed25519 keys, see `packages/services/auth/service.js:88`). In memory cache is plaintext; `dump` command refuses to print values.
- **CLI**: `yamf config set <service> --env prod KEY=VALUE` (prompts if value omitted, never echoes); `yamf config get <service> --env prod` (masked by default, `--reveal` needs admin token). Implemented in `packages/cli/src/commands/config.js`.
- **Integration with pm3 spawn** (the only code path where plaintext lands on disk is the child process env):

  ```js
  // inside planAndApply, just before pm3.start
  const required = service.env || []
  if (required.length) {
    const resp = await httpRequest(registryUrl, {
      headers: { [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL, [HEADERS.SERVICE_NAME]: 'config-service' },
      body: { command: 'get', service: service.name, env: target }     // target = 'dev'|'prod'|...
    })
    Object.assign(env, resp.values)     // config-service values overlay build env
    env.YAMF_CONFIG_VERSION = String(resp.version)
  }
  ```

- **Overlay order** (least → most authoritative): defaults in code < `yamf.config.js` `env: [...]` (names only) < config‑service values < `process.env` at CLI invocation time (so an operator can override at deploy). Document this, and add a test.
- **Rotation**: `yamf config set … KEY=newvalue` bumps `version` → next `yamf deploy` sees the bump and forces a rolling restart (even if `sourceHash` unchanged). Add `configVersion` to `replicaMetadata` alongside `sourceHash`; decision table treats differing `configVersion` like differing hash.

#### Cross‑cut 6 — dev/prod parity checklist

Review gate before C3 and D1 merge. Do not ship if any of these are false:

- [ ] `yamf deploy --local` and `yamf deploy --remote` call the **same** `planAndApply` function; only the `pm3` adapter and `registryUrl` differ.
- [ ] `yamf dev` drives redeploys by calling the same `planAndApply` — there is no "dev‑only" spawn path.
- [ ] Source‑hash computation is identical across modes (same `computeBundleHash`, same esbuild config). CI asserts `yamf build` then `yamf build` produces byte‑identical hashes on two runners.
- [ ] `config-service` is queried in all three modes; `YAMF_CONFIG_VERSION` appears in replica metadata in all three.
- [ ] `yamf status --versions` shows identical fields for local and remote targets.
- [ ] A single test harness (new `packages/cli/tests/integration/deploy-parity.js`) runs the same deploy against a local pm3 and a fake remote registry and asserts the resulting replica set is structurally equal.

### Slice C — CLI remote deployments + pm3 deploy service  `[large]`

**Goal.** `yamf deploy --remote <target>` from a dev machine rolls out changed services to a cluster **without** depending on k8s. Build locally with esbuild, calculate a content hash, ship bundles to a registry, which replicates to remote `pm3-service` nodes. **The framework itself becomes a system‑agnostic orchestrator**; k3s is one viable substrate, bare‑metal pm3 nodes another.

This is large; the value is in sub‑slicing (see end) — each sub‑slice is individually useful.

#### Sequence

```mermaid
sequenceDiagram
  participant Dev as Dev CLI
  participant Reg as Registry
  participant PM3 as pm3-service (each node)
  participant Svc as Service process

  Dev->>Dev: yamf build (esbuild all/changed services)
  Dev->>Dev: compute sha256 per bundle; cache in .yamf/build/
  Dev->>Reg: POST DEPLOY_PLAN {service, hash, meta, routes}
  Reg-->>Dev: {decision: rollout|scale|noop, targetNode}
  alt rollout (hash changed)
    Dev->>Reg: PUT DEPLOY_BUNDLE (stream bytes)
    Reg->>Reg: verify sha256 == manifest hash
    Reg->>PM3: DEPLOY_SERVICE {service, hash, bundleUrl, env}
    PM3->>PM3: download bundle, spawn replica
    PM3-->>Reg: HEALTHY
    Reg->>Reg: REGISTRY_DRAIN old replica (existing slice)
    Reg-->>Dev: done {newHash}
  else scale (hash unchanged, load)
    Reg->>PM3: SCALE_SERVICE {service, hash, +1}
    PM3-->>Reg: HEALTHY
  else noop (hash unchanged, enough replicas)
    Reg-->>Dev: noop
  end
```

#### Design commitments

1. **`yamf build`**. New CLI command, `packages/cli/src/commands/build.js`.
   - Discovers services via `yamf.config.js` (`{ services: [{ name, entry, env?, replicas? }] }`) or `--service <entry>` flags.
   - Runs esbuild with `{ format: 'esm', platform: 'node', target: 'node20', sourcemap: true, external: ['@yamf/*'] }`.
   - Output: `.yamf/build/<service>/<sha256>.mjs` + `<sha256>.meta.json` (entry, env requirements, dep list, `createdAt`).
   - **Source hash** = sha256 over the bundle bytes, appended with the stable `meta.json` of dependencies.
   - Cached; re‑running without changes is a no‑op.

2. **`yamf deploy`**. `packages/cli/src/commands/deploy.js`. Flags:
   - `--remote <url|name>` (default: `$YAMF_REGISTRY_URL`).
   - `--dry-run` — prints plan, no network side effects.
   - `--service <name>` (repeatable) / `--all`.
   - `--only-changed` (default) / `--force`.
   - **Must propagate `YAMF_SOURCE_HASH=<bundle hash>`** into every spawned service's env at C2 and beyond. Services include it in `metadata.sourceHash` on registration; this is what powers `yamf status --versions`, slice C5's rollback‑by‑hash, and cross‑cut 3's deploy audit. Doing this at C2 (local only) means hash‑aware observability ships the moment any deploy path exists, not a phase later.

3. **Manifest contract (CLI → registry).**
   ```jsonc
   // DEPLOY_PLAN
   {
     "services": [
       { "name": "track-service", "hash": "sha256-…", "meta": { "entry": "…", "env": ["DB_HOST"] }, "replicas": 2 }
     ],
     "commit": "<git sha, optional>",
     "deployer": "<user@host, optional>"
   }
   ```

4. **Registry role** (`packages/core/src/registry/deploy-router.js`, new):
   - Auth: `YAMF_DEPLOY_TOKEN` (separate from `YAMF_REGISTRY_TOKEN`; see §8) + optional signature (see §7).
   - **Decision table per service** (existing `sourceHash` field, new, on service registry records):
     | Current | Incoming | Decision |
     |---|---|---|
     | none | any | **rollout** (first deploy) |
     | `X` | `X`, under desired replicas | **scale** |
     | `X` | `X`, at/over replicas | **noop** |
     | `X` | `Y ≠ X` | **rollout** (new version) |
   - **Verify bundle hash**: on `PUT DEPLOY_BUNDLE`, stream the body through sha256 and require it to match `hash` from the plan. If mismatch → `422`.
   - **Placement**: pick least‑loaded `pm3-service` node (reuse existing registry cache of healthy nodes). Content‑addressed bundle store in `YAMF_BUNDLE_DIR` (default `${YAMF_HOME}/bundles/`).
   - **Rolling** reuses the existing primitives: new replica spawns, registers, `REGISTRY_DRAIN` the old one, old node broadcasts `SERVICE_SHUTDOWN`.

5. **`pm3-service` deploy command.** Extends `packages/services/pm3/service.js` with:
   ```js
   case 'deploy': {
     // payload: { service, hash, bundleUrl|bundleBytes, env }
     // 1. fetch/write to /var/yamf/bundles/<hash>/service.mjs if missing
     // 2. pm3.start('/var/yamf/bundles/<hash>/service.mjs', { name: `${service}@${hash.slice(0,8)}`, env })
     // 3. wait for registry to see it healthy, return { ok, pid }
   }
   ```
   Runs in‑cluster (pod) or on a bare node; same contract. Registry fans `DEPLOY_SERVICE` to one or more `pm3-service` replicas depending on desired placement.

6. **Versioning, rollback, and load‑balancing.**
   - Content‑addressed bundles → **`yamf deploy --rollback <hash>`** is `scale a known hash, drain the newer one`; no artifact store beyond the local bundle dir.
   - **Same hash → scale**: registry treats replicas of the same hash as a load‑balance pool; service lookup returns the whole pool and existing round‑robin applies. **Different hash → rolling**: a single logical service can briefly have N replicas of `X` and 1 of `Y`, then flips.
   - `yamf status` gets a `--versions` flag printing each service's current hash + replica breakdown.

7. **Identity and integrity.**
   - **Tier 1 (simple, default for homelab):** HMAC of bundle with `YAMF_DEPLOY_TOKEN` in `yamf-deploy-sig` header; registry recomputes.
   - **Tier 2 (opt‑in):** ed25519 signature from a developer key; registry keeps an allow‑list of pubkeys in `${YAMF_HOME}/deploy/authorized_keys`. Reuses `packages/core/src/shared/crypto.js` helpers and the same keypair persistence story as `createAuthService`.
   - **Audit log**: `publishMessage('yamf:deploy', { service, hash, deployer, decision, at })`; apps can tail it.

8. **Admin‑scoped auth service (optional).** For non‑local envs, run a **second** auth service instance (e.g. `admin-auth-service`) with its own keypair, dedicated token issuer, and a different `YAMF_DEPLOY_TOKEN`. Registry's deploy router only accepts tokens issued by that instance; product traffic keeps using the primary auth service. This keeps "who can deploy" cryptographically separate from "who is a user".

9. **Dev ergonomics.**
   - `yamf deploy --local` (new pm3 service on `127.0.0.1` or the existing local pm3) — same code path, different endpoint.
   - `yamf logs --service <name> --hash <prefix>` tails by version so A/B during rollout is observable.

10. **Failure modes.**
   - **Hash mismatch** on registry → `422 { code: 'bundle-hash-mismatch' }`.
   - **Insufficient pm3 nodes** for placement → `503 { code: 'no-placement' }`.
   - **Health never reached** on new replica → registry aborts, logs, retains old replica, surfaces error to CLI.
   - **Partial rollout** across replicas → registry records per‑replica hash and keeps trying; `yamf status --versions` reveals drift.

#### Sub‑slicing (strongly recommended)

- **C1** — `yamf build` + bundle cache. **No deploy.** Dev can inspect `.yamf/build/` and diff hashes across commits. Framework change is small; value immediate (caching + visibility).
- **C2** — Local `yamf deploy --local` (no remote). CLI → local pm3, end‑to‑end, without `pm3-service`. Proves the `sourceHash` → decision table.
- **C3** — `pm3-service deploy` command + registry bundle store + single‑node remote deploy with `DEPLOY_TOKEN`.
- **C4** — Multi‑node placement + rolling using the existing drain primitives.
- **C5** — Hash‑same‑as‑scale, hash‑diff‑as‑rollout, rollback by hash.
- **C6** — ed25519 signed bundles + admin‑auth instance. *Tier 2 bundle signatures + `authorized_keys` shipped; admin‑only auth service not yet.*

### Slice D — Dev client hot‑reload over SSE  `[medium/large]`

**Goal.** One command brings up a full dev stack where:
- **Server service** source changes trigger auto‑rebuild and in‑place reload.
- **Client** assets (SPA bundle) rebuild triggers a targeted reload in every attached browser.
- Both work **against a remote dev registry** — edit locally, see the remote reflect within a second or two.

Leverages slice 3's `createEventSourceService` + `broadcastRender` and slice C's `yamf build`.

#### Design commitments

1. **`yamf dev`** CLI. `packages/cli/src/commands/dev.js`:
   - Starts a local registry + gateway (or connects to a remote one with `--remote`).
   - Watches `src/**/*.js` (chokidar) for each service entry in `yamf.config.js`.
   - On change → `yamf build` (cached by hash) → `yamf deploy --local` or `--remote` (slice C).
   - Emits `yamf:dev-reload` pub/sub message on successful redeploy.

2. **`@yamf/dev-hmr` service** (`packages/services/dev-hmr/`). An SSE service subscribed to `yamf:dev-reload`:
   - Channel handler broadcasts `event: reload` with `{ service, hash }` to every connected browser.
   - In `renderMode: 'html-handlers'` apps, can also push a targeted `broadcastRender` of the changed page fragment.

3. **Client bootstrap `@yamf/client/dev-hmr`** (`packages/client/src/dev-hmr.js`):
   - Opens an `EventSource` to `/yamf-dev`.
   - On `reload` event: by default hard‑reloads (`location.reload()`). Advanced mode (opt‑in) calls a user‑supplied `applyPatch({ service, hash })` so state‑preserving reloads are possible for apps that want them.
   - Injected only when `YAMF_DEV=on`; no‑op in production builds.

4. **Vite / SPA integration.** **`@yamf/client/vite-plugin-yamf-dev`** (`yamfVitePluginDev()`) calls `handleHotUpdate` → debounced `publishMessage` to `PUBSUB_CHANNEL_YAMF_DEV_RELOAD` so D2’s SSE path reloads all attached browsers when the SPA rebundles. Vite and `yamf dev` can run side‑by‑side (same `YAMF_REGISTRY_URL`).

5. **Remote dev flow.**
   - `yamf dev --remote https://dev.example.com`.
   - CLI watches locally, builds locally, pushes via slice C with the **dev** `DEPLOY_TOKEN`.
   - Registry rolling redeploys the service; `@yamf/dev-hmr` in the remote broadcasts to any dev browsers pointed at `https://dev.example.com`.
   - Same ergonomics as local dev, with TLS and an auth token between CLI and registry.

6. **State preservation (advanced, optional).**
   - Today Soundclone's client holds rich state (player, queue, library). Default reload drops it.
   - With `applyPatch({ service })` supplied, the app can short‑circuit: re‑fetch data from the reloaded service, call `setTracks` etc., without a full nav.
   - The slice 3 `broadcastRender` primitive + `ssr-hydrate` already handles in‑place DOM patching for server‑rendered islands, which composes with this cleanly.

7. **Safety**. `@yamf/dev-hmr` refuses to start unless `YAMF_DEV=on` **and** `NODE_ENV !== 'production'`; the SSE endpoint is gated by the dev `DEPLOY_TOKEN` (not the primary auth service) to prevent accidental exposure.

8. **Sub‑slicing.**
   - **D1** — `yamf dev` + file watch + local redeploy (requires C1/C2). No client HMR yet.
   - **D2** — `@yamf/dev-hmr` SSE service + `@yamf/client/dev-hmr` client → full page reload on change.
   - **D3** — `yamfVitePluginDev` in `@yamf/client/vite-plugin-yamf-dev` (HMR → `yamf:dev-reload` pub/sub).
   - **D4** — `applyPatch` / `createYamfDevHmrSpaPatch` (slice 3 / `broadcastRender` only for SSR HTML apps).

### Cross‑cutting concerns for the orchestrator story  `[must‑land with C/D]`

If slices C and D push YAMF toward "system‑agnostic small orchestrator", these are the gaps to close **in parallel** or they'll bite the first real rollout:

1. **Secrets / config separation from bundles.**  **Hard gate on slice C3** — shipping remote deploy without this bakes in "secrets live in the bundle" as precedent, and that is a one‑way door. Content‑addressed bundles **cannot** carry env‑specific secrets — the same hash must deploy to dev and prod. The registry (or a dedicated `config-service`) owns per‑service config: `{ service, env, values: { DB_PASS, … }, version }`. PM3 `deploy` command receives **bundle + config version**; applies env at spawn. Rotating a secret is a **config bump**, not a rollout, so it's cheap.

2. **Contract‑aware rolling.** Runtime service contracts already land (see `.cursor/plans/runtime_service_contracts_056b2fe6.plan.md`). Tie it into slice C's decision table:
   - `yamf deploy --dry-run` surfaces **contract diffs** between incoming hash and current hash.
   - Registry refuses to mark a new replica healthy if its contract is **backward‑incompatible** with registered callers (configurable override `--allow-breaking`).
   - Cheapest guard against the #1 failure mode of hash‑based rollouts: "new service deployed, old callers break silently".

3. **Deploy audit + observability.** First‑class events, not just log lines:
   - `publishMessage('yamf:deploy', { service, fromHash, toHash, decision, deployer, at })`.
   - `yamf status --versions` shows per‑service replica→hash map (promoted from "nice to have" in slice C to table stakes).
   - `/health` on the registry exposes deploy queue depth + last 50 decisions as structured JSON.

4. **Auto‑re‑placement on replica loss.** pm3 restarts a dead local process; the orchestrator needs to notice **repeated** failures (N restarts in M minutes) and **re‑place** the replica on another node, or flag the service as unhealthy so gateway stops routing. Reuse the existing `HEALTH` poll + drain primitives.

5. **Canary / percentage rollouts.** Natural extension of the decision table once same‑hash replicas are a load‑balance pool: `yamf deploy --canary 10%` keeps `N * 0.9` of hash `X` and `N * 0.1` of hash `Y`, auto‑advances on time or explicit `yamf promote`. Rollback is just re‑scaling `X` and draining `Y` — already supported by C5.

6. **Dev/prod parity.**  **Design review gate before C3 and D1 ship**, not a standalone slice. `yamf dev` (slice D), `yamf deploy --local` (C2) and `yamf deploy --remote` (C3+) must resolve to the **same** code path with different defaults (token, remote URL, watch mode). If they diverge, the "works locally, breaks on remote" bug class comes back — and it comes back *in production*, not in tests.

### Phase 3 implementation details  `[shipped — reference, D1 / C3 / C4 / C5]`

Consolidated snippets for the **remote / rolling** work (in tree). `planAndApply` remains the single entry point. Cross‑cut **2** (full contract gate) and **3** (rich registry deploy ring) may exceed what is wired; see *Active follow‑on work*.

#### D1 — `yamf dev` (watch + debounce on top of Phase 2)

```js
// packages/cli/src/commands/dev.js (new)
import chokidar from 'chokidar'
import { loadYamfConfig } from '../lib/load-yamf-config.js'
import { buildServiceEntry } from './build.js'
import { planAndApply } from '../lib/deploy-driver.js'
import { PM3 } from '../lib/pm3.js'

export async function runDevCommand () {
  const cfg = await loadYamfConfig()
  const registryUrl = process.env.YAMF_REGISTRY_URL
  const debounceMs  = Number(process.env.YAMF_DEV_DEBOUNCE_MS || 200)
  const pm3 = new PM3()                                // swap for remote adapter when `--remote` lands
  const timers = new Map()                             // per‑service debounce — parallel deploys

  const trigger = (svc) => {
    clearTimeout(timers.get(svc.name))
    timers.set(svc.name, setTimeout(async () => {
      try {
        const { hash } = await buildServiceEntry(cfg, svc)
        const res = await planAndApply({ yamfService: svc, hash, pm3, registryUrl, envTarget: 'dev' })
        process.stdout.write(`[dev] ${svc.name} ${res.decision} ${hash.slice(0, 16)}\n`)
      } catch (err) {
        // failed build/deploy MUST NOT stop the watcher — previous replicas keep serving
        process.stderr.write(`[dev] ${svc.name} failed: ${err.message}\n`)
      }
    }, debounceMs))
  }

  const entries = cfg.services.filter(s => !s.internal).map(s => s.entry)
  const watcher = chokidar.watch(entries, { ignored: ['**/node_modules/**', '**/.yamf/**'], ignoreInitial: true })
  watcher.on('all', (_e, p) => {
    for (const svc of cfg.services) if (!svc.internal && p.endsWith(svc.entry)) trigger(svc)
  })
  for (const svc of cfg.services) if (!svc.internal) trigger(svc)   // initial pass
}
```

Key design choices:

- **Per‑service debounce**, not global — saves in two service files deploy in parallel.
- **Failed build never stops the watcher.** Previous replicas keep serving; next edit re‑triggers.
- `--remote` is the same code path with `pm3` swapped for a remote adapter (C4) and `registryUrl` pointing at the dev cluster. That's cross‑cut 6's parity contract in action.

#### C3 — deploy router, bundle store, and pm3‑service `deploy`

**Deploy router is a Slice‑F plugin, not core.** Keeps the kernel minimal and is the first real‑world validation of the plugin model.

```js
// packages/services/deploy-router/service.js (new)
// Depends on @yamf/core registry + Slice F registerCommand.
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { createWriteStream, renameSync, unlinkSync, existsSync } from 'node:fs'
import { HttpError, publishMessage } from '@yamf/core'

export function attachDeployRouter (registry, { bundleStore, deployToken }) {
  // deploy-plan: CLI → registry decision. Same table as Phase 2 `planAndApply`, but server‑side.
  registry.registerCommand('deploy-plan', async ({ body }) => {
    const decisions = []
    for (const s of body.services || []) {
      const reps  = registry.getReplicasFor(s.name)           // thin wrapper over replicaMetadata
      const same  = reps.filter(r => r.sourceHash === s.hash)
      const other = reps.filter(r => r.sourceHash && r.sourceHash !== s.hash)
      const d = reps.length === 0 ? 'rollout'
        : other.length > 0                ? 'rolling'
        : same.length < (s.replicas ?? 1) ? 'scale'
        :                                   'noop'
      decisions.push({ service: s.name, hash: s.hash, decision: d })
    }
    return { decisions }
  }, { requireDeployToken: true })

  // deploy-bundle: streaming PUT with on‑the‑fly sha256, 422 on mismatch.
  registry.registerCommand('deploy-bundle', async ({ request, headers }) => {
    const hash = headers['yamf-deploy-hash']
    if (!hash) throw new HttpError(400, 'yamf-deploy-hash required')
    if (existsSync(bundleStore.pathFor(hash))) return { stored: hash, deduped: true }
    const h = createHash('sha256')
    const tmp = bundleStore.pathFor(hash) + '.part'
    await pipeline(
      request,
      async function* (src) { for await (const c of src) { h.update(c); yield c } },
      createWriteStream(tmp)
    )
    if (`sha256-${h.digest('hex')}` !== hash) {
      try { unlinkSync(tmp) } catch { /* */ }
      throw new HttpError(422, 'bundle-hash-mismatch')
    }
    renameSync(tmp, bundleStore.pathFor(hash))
    return { stored: hash }
  }, { requireDeployToken: true })
}
```

**Slice‑F follow‑up required.** `registerCommand` today accepts `{ requireRegistryToken }`. Add `requireDeployToken` to `packages/core/src/registry/command-router.js` (check `yamf-deploy-token` against `envConfig.get('YAMF_DEPLOY_TOKEN')`, 401 on mismatch). This is ~10 lines; better than reusing the registry token so the blast radius of a leaked deploy token is one command family, not the whole registry.

**Bundle store** is content‑addressed at `${YAMF_BUNDLE_DIR}/<hash>.mjs` (default `${YAMF_HOME}/bundles/`). Writes via tmp+rename; reads are idempotent; GC is the same "never prune a hash listed in `replicaMetadata`" rule that guards `yamf build --prune`.

**`pm3-service` `deploy` case.** Extends `packages/services/pm3/service.js` inside the existing `switch (command)`:

```js
case 'deploy': {
  const { service, hash, env } = payload
  const bundlePath = join(managedServicePath, `${hash}.mjs`)
  if (!existsSync(bundlePath)) {
    const resp = await fetch(`${registryUrl}/bundles/${hash}`, {
      headers: { 'yamf-deploy-token': deployToken }
    })
    if (!resp.ok) throw new HttpError(502, `bundle fetch failed: ${resp.status}`)
    const tmp = bundlePath + '.part'
    await pipeline(Readable.fromWeb(resp.body), createWriteStream(tmp))
    renameSync(tmp, bundlePath)
  }
  return pm3.start(bundlePath, {
    env: {
      ...env,
      YAMF_SOURCE_HASH: hash,
      YAMF_BUNDLE_PATH: bundlePath,
      YAMF_NODE_ID: process.env.YAMF_SERVICE_URL      // see C4
    }
  })
}
```

**Remote `pm3` adapter for `planAndApply`.** The Phase 2 driver takes `pm3` as a duck‑typed `{ start, restartRolling }`. For remote, implement the same surface against `pm3-service`:

```js
// packages/cli/src/lib/remote-pm3-adapter.js (new)
import { httpRequest, HEADERS, COMMANDS } from '@yamf/core'
export function createRemotePm3 ({ registryUrl, deployToken }) {
  const call = (payload) => httpRequest(registryUrl, {
    headers: {
      [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
      [HEADERS.SERVICE_NAME]: 'pm3-service',
      'yamf-deploy-token': deployToken
    }, body: payload
  })
  return {
    start:           (bundlePath, { env }) => call({ command: 'deploy', hash: env.YAMF_SOURCE_HASH, service: env.YAMF_SERVICE_NAME, env }),
    restartRolling:  (service, { env, bundlePath }) => call({ command: 'rolling-deploy', service, hash: env.YAMF_SOURCE_HASH, env })
  }
}
```

Crucially, **Phase 2's `planAndApply` is unchanged**. Only the injected adapter differs. That's how cross‑cut 6 parity is enforced by construction.

#### C4 — multi‑node placement

**Registry needs to know which node a replica is on.** Smallest possible change: `pm3-service` stamps its own location into every spawned service's env, and the service's existing Phase 2 metadata propagation picks it up.

```js
// packages/core/src/api/service-helpers.js — registerServiceWithRegistry
const nodeId = envConfig.get('YAMF_NODE_ID', null)
if (nodeId) metadata = { ...(metadata || {}), node: nodeId }
```

```js
// packages/core/src/registry/service-registry.js — registerService
const { sourceHash, configVersion, node, ...metadataForService } = metaObj
if (sourceHash != null || configVersion != null || node != null) {
  state.replicaMetadata.set(replicaKey, {
    ...(prevR || {}),
    ...(sourceHash    != null ? { sourceHash }    : {}),
    ...(configVersion != null ? { configVersion } : {}),
    ...(node          != null ? { node }          : {}),
    registeredAt: Date.now()
  })
}
```

No separate placement tracking table — the registry learns placement at the same moment it learns the replica exists. `serializeReplicaMetadata` already passes through arbitrary fields, so `yamf status --versions` surfaces `node` automatically.

**Placement selector** (least‑loaded by replica count; pluggable later):

```js
// packages/services/deploy-router/placement.js
export function pickNode (registry, { excludeNodes = [] } = {}) {
  const nodes = registry.listHealthyLocations('pm3-service')
  const load = new Map(nodes.map(n => [n, 0]))
  for (const [, meta] of registry.state.replicaMetadata) {
    if (meta.node && load.has(meta.node)) load.set(meta.node, load.get(meta.node) + 1)
  }
  const candidates = [...load.entries()].filter(([n]) => !excludeNodes.includes(n)).sort((a, b) => a[1] - b[1])
  if (!candidates.length) throw new HttpError(503, 'no-placement')
  return candidates[0][0]
}
```

**Rolling across nodes.** For each old replica, `pickNode({ excludeNodes: [oldReplica.node] })` prefers a different host so the rolling step also tolerates a node going away. Drain the old replica only after the new one registers on its new node.

#### C5 — rollback‑by‑hash

CLI wiring only; decision table already handles it.

```js
// packages/cli/src/commands/deploy.js — new flag
--rollback <hash>   // shorthand for --hash <hash> --force, audited as decision: 'rollback'
```

**Semantic guard** worth adding up front: if the target hash has no bundle in `.yamf/build/<svc>/` **and** no entry in the registry bundle store, fail fast with `no-bundle-for-rollback-hash` instead of starting a rollout that errors mid‑way. One filesystem check, saves an operator a rollback‑of‑a‑rollback.

Phase 2 already ships `configVersion` in `replicaMetadata`; `yamf config set` bumps `configVersion`, and `planAndApply`'s `otherHash` check catches version drift too — so "rotate secret, roll replicas" just works, no separate code path.

#### Cross‑cut 2 — contract‑aware rolling

Tie to the runtime contracts work tracked in `.cursor/plans/runtime_service_contracts_*.plan.md`.

- `yamf deploy --dry-run` diffs current vs. incoming contract (already on `REGISTRY_PULL`), prints added/removed/changed fields, exits non‑zero on incompatibilities unless `--allow-breaking`.
- Registry refuses to promote a rolling replica to `healthy` if `isBackwardCompatible(current, incoming) === false`. Hook point is wherever the registry transitions a replica out of "warming" — today that's implicit in first‑call success; add an explicit `markReplicaHealthy(service, location)` step in `service-registry.js` so the contract gate has a single place to live.

#### Cross‑cut 3 — deploy audit events

One event, emitted from the deploy router on every decision transition:

```js
// packages/services/deploy-router/service.js — at the end of each decision branch
publishMessage('yamf:deploy', {
  service,
  fromHash, toHash,
  decision,                                      // rollout | scale | rolling | noop | rollback
  node,                                          // C4
  configVersion,                                 // Phase 2
  deployer: headers['yamf-deployer'] || null,    // "user@host" or API key id; opaque
  at: Date.now()
})
```

- Apps subscribe via `createSubscriptionService('…', { channels: ['yamf:deploy'] })`; no new wire primitive.
- Registry `/health` gains `deploy: { queueDepth, last50: [{ service, toHash, decision, at }] }` — a ring buffer on the registry process, cheaper than scanning the pub/sub log and enough for operator "what just happened" questions.
- `yamf status --versions --since <duration>` reads the same ring buffer via a new `deploy-events` registry command (also a Slice‑F plugin extension — keeps core tiny).

#### Prerequisites summary for Phase 3

**Historical (C3 shipped):** the items below were **pre‑C3** gates. **2–4** are in tree (`requireDeployToken` on deploy commands, `node` in `replicaMetadata`, `getReplicasFor` / healthy placement helpers for deploy-router). **1** (cross‑cut 1 hardening) remains in *Active follow‑on work*.

### Lower‑priority cleanup (tracked, not blocked on shipped slices A–E)

- `createService` and `createSubscriptionService` both branch into a pure variant with duplicate lifecycle plumbing. Extract `createLocalService({ name, handler, access, cache, context, pubSubManager? })` so public factories only describe type‑specific bits.
- `createService`'s `pureServiceWrapper` can drop the `undefined` sentinel once `before()` is first‑class on `createPureService`.
- `createPureSubscriptionService` double‑logs "Pure subscription service … registered" on the `local-logger` path; collapse.
- `notifyRegistryOfPureService` silently returns `null` on failure; either bubble up or add explicit `suppressRegistryWarning`.

---

## Towards 1.0

YAMF's identity shifts with slices C + D: from "service framework with rolling support" to **"small, system‑agnostic orchestrator that also happens to be a service framework"**. A 1.0 bar worth committing to:

- **Shipped (framework):** slices A, B, C (through C5), D2–D3, D4 (SPA helper + SoundClone; slice‑3 apps still own re-hydration), E, F, C6 (Tier 2), deploy router; cross‑cut 1 (v1); cross‑cut 3 baseline (`yamf:deploy` pub). **Cross‑cuts 2, 4, 5, 6** (full diff gate, canary, auto re‑placement, automated parity) are **not** "done" as originally specified — some are polish, some are deferred to post‑1.0.
- **Doesn't ship yet (typical 1.0 + horizon):** federation / multi‑registry gossip, cascade fan‑out (see Deferred below), non‑JS bundle deploys, mTLS between nodes (tokens + signed bundles remain primary), D4 in **every** app / HTML‑handler SSR, **gateway–registry continuity** (hold, last‑known routing, split‑brain mitigations — horizon subsection in Deferred).
- **Story:** a single binary (`yamf`) takes you from `yamf init` to `yamf dev` to `yamf deploy --remote`, on k3s **or** a fleet of plain VMs, with rolling + rollback + contracts + secrets management, zero vendor dependencies.
- **Plugin model formalized.** Already mostly true — `@yamf/services-*` packages are plugins today. At 1.0, name it explicitly: **core is a tiny kernel** (registry state, gateway routing, HTTP primitives, pub/sub, lifecycle); **everything else is a service** that can be swapped or omitted. Concretely:
  - **Always‑there kernel:** `create-service`, `create-route`, `create-subscription-service`, `create-event-source-service`, registry, gateway, pub/sub, lifecycle, call‑service, HTTP primitives.
  - **Default‑but‑replaceable:** rate‑limiter (in‑process today; expose `createRateLimiterService` wire so apps can swap in Redis/etc.), `simpleSecurityCheck`, auth‑via‑token.
  - **Optional services** (all plain YAMF services; mix and match): `config-service`, `secrets-service`, `deploy-router` (slice C), `dev-hmr-service` (slice D), `metrics-service`, `audit-service`, `schema-registry-service`, `queue-service`, `scheduler-service`, `blob-service`, `notify-service`.
  - **Registry extension point (small, high‑leverage):** `registerCommand(name, handler)` on the registry command router so a plugin service (e.g. `deploy-router`, `schema-registry`) can add new `yamf-command:` verbs without editing core. **Shipped as [Slice F](#slice-f--registry-command-extension-point--shipped--reference).**
- **Branding (optional, cheeky).** Retronym the name at 1.0: **YAMF — "Yet Another Mini‑orchestration Framework"**, or lean into the cheeky negation (**"YAMF Ain't a Microservice Framework"**). Doesn't require an npm namespace move; just README + marketing copy.

---

## Deferred (post‑1.0)

### Soundclone S3 lazy init
Swap synchronous S3 bring‑up for lazy‑on‑first‑call. Expected side benefit: fixes `yamf start` startup flakiness since services no longer block on S3.

### Local FS expiration / resync system
Companion to the S3 lazy init. Cache eviction policies, S3‑of‑record reconciliation, orphan cleanup. Needs its own design pass.

### Multi‑region / multi‑registry federation
Once slice C is in, **replicating bundles across registries** is a natural extension: `registry-a` gossips new hashes to `registry-b`, each pm3 pool deploys independently, service discovery spans both. Out of scope until C4/C5 prove out.

### Scale envelope (observed / estimated)

Based on what's actually cached today (`packages/core/src/registry/registry-state.js`, `packages/core/src/service/service-state.js`):

- **Per service name**, registry holds: name, access, auth, metadata, contract, type, timeout → roughly **0.5–2 KB** (contract dominates).
- **Per replica**, registry holds: location in `services` + `addresses` + per‑service sub/metadata → roughly **~120 bytes**.
- **Every non‑pure service caches all of the above** (minus registry‑only bits).

Envelope:

| Scenario | Services | Replicas | Per‑replica cache | First thing that strains |
|---|---|---|---|---|
| **Comfortable today** | ≤ 300 | ≤ 1 000 | < 2 MB | nothing |
| **Tunable, no arch change** | ≤ 1 000 | ≤ 5 000 | ~10 MB | cache‑update fanout during deploy storms |
| **Needs design changes** | ≥ 10 000 | ≥ 10 000 | ≥ 50 MB | fanout, registration thundering herd, single‑registry throughput |

**First real bottleneck is update fanout, not memory** (with coalescing **off**). `publishCacheUpdate` in immediate mode hits every non‑pure subscriber on every registration. A whole‑fleet deploy of N services with R replicas per service costs roughly **N × (N × R)** HTTP calls at the registry. Memory stays small long after fanout starts hurting.

Mitigations, in order of diminishing returns:

- **Coalesced bulk cache updates — [Slice E](#slice-e--coalesced-bulk-cache-updates--shipped--reference) shipped.** Set `YAMF_CACHE_COALESCE_MS > 0` and use bulk-capable subscribers (`cacheBulk: true`); cuts outbound calls by roughly the coalesce window batch size.
- **Lazy cache pull on first call** — services start with an empty cache and pull on the first `callService('foo')` miss; the full‑fanout path becomes optional (`YAMF_EAGER_CACHE=on` for today's behavior). Small patch, plays nicely with E.
- **Cascade fan‑out of cache updates** — see below; meaningful only once E + lazy pull are in and the registry is **still** the bottleneck.
- **Sharded registries** (dovetails with federation above) — partition by service name prefix or tenant; each registry authoritative for its shard.
- **Contract size cap** — warn if a contract grows past e.g. 8 KB; encourage `contract-ref` to a hash in a schema registry once cross‑cut 2 lands.

### Cascade fan‑out of cache updates  `[horizon, post‑E]`

**Goal.** Beyond coalescing, distribute the fan‑out work itself. The registry stops being responsible for 100% of outbound cache‑update calls; a subset of recipients forward to their peers, halving (or better) registry egress in exchange for slightly more topology state per window.

**Not a 1.0 item.** Slice E alone likely defers this by an order of magnitude of scale (think "thousands of services, tens of thousands of replicas"). The design sketch below is deliberately fleshed out so it's clear which half is worth doing first if we ever reach the bottleneck.

**High‑level shape:**

1. **Coalesce first** (slice E, shipped) — cascade only kicks in when a window would hit more than `YAMF_CASCADE_MIN` recipients (default `64`). Small fleets stay on flat fanout; no added complexity.
2. **Partition recipients.** Registry splits the subscriber list into `K` roughly equal buckets (default `K = ceil(sqrt(M))`; e.g. 100 subscribers → 10 head replicas × 10 peers each).
3. **Wire shape**, per bucket:
   ```jsonc
   // POST to the head replica
   {
     "updates": [ { "subscription": "register", "service": "…", "location": "…", "contract": "…", "hash": "sha256-…" } ],
     "forwardTo": [ "http://peer-a:…", "http://peer-b:…" ],
     "origin": { "registry": "…", "windowId": "w-2026-04-23T18:33:01Z-7" }
   }
   ```
   The head applies updates locally, then **forwards the exact same payload minus `forwardTo`** to each peer. Depth is configurable; default is 1 (star), 2 (head→mid→leaf) is possible if `M > ~1000`.
4. **Short‑circuit via hash (the clever bit).** Every update carries its service+contract hash. A recipient consulting its local cache sees either:
   - **same hash already present** → drop update, do **not** forward downstream. This is where `hash = version` from slice C pays compound interest: redundant propagations collapse at the recipient instead of bouncing through the full tree.
   - **missing or different hash** → apply, then forward.
5. **Trust model.** Registry signs the `(updates, origin, windowId)` tuple with `YAMF_REGISTRY_TOKEN` (or the rotating registry ed25519 key once slice C Tier 2 lands). Signature + the payload hash go in `yamf-cascade-sig` / `yamf-cascade-payload-hash` headers. Forwarders must copy both untouched; peers verify the **registry** signature, not the forwarder. A rogue forwarder can drop updates (failure surfaces in the next item) but cannot inject fakes.
6. **Failure reporting.** Head returns `{ windowId, delivered: [...locs], failed: [...locs] }`. Registry retries `failed` peers directly (flat fallback) once before marking them stale. A misbehaving head degrades to "flat for that window"; no stuck states.
7. **Debuggability.** `yamf-cascade-window-id` is propagated on every hop and surfaced in logs + `/health` so "which update came through what path" is answerable.

**Complexity vs payoff:**

- ~500–800 LOC spread over `pubsub-manager.js`, `cache-handler.js`, a new `cascade-forwarder.js` on the service side, and signed‑payload utilities in `shared/yamf-headers.js`.
- Distributed‑systems surface area: retry dedup (same `windowId` replayed should be a no‑op once short‑circuit is in), signed‑payload verification, partial failures. Each answerable in isolation, together they're a testing multiplier.
- Registry egress: **O(K + retries)** instead of **O(M)**; at `K = sqrt(M)` that's `O(sqrt(M))`.

**Verdict.** Worth capturing now so the hooks (hash‑versioned updates, `windowId`, signed payloads) can be designed consistent with slice C. Not worth shipping until post‑E traces show registry egress saturating around several thousand subscribers. Federation / sharded registries is an equally plausible answer at that point; we pick whichever the observed load pattern argues for.

### Non‑JS bundle deploys
`yamf build` is esbuild‑shaped; Python/Go services in `packages/core/examples/` register fine today but aren't bundleable the same way. Treat them as **opaque bundles** (container image reference, or tarball + entry command in `meta.json`) and let `pm3-service` run them via `docker run` / `uv run` / `go run`. Core protocol is unchanged — only the build + spawn adapters differ. Defer until we have one real non‑JS service in production.

### mTLS between services
Today services authenticate to the registry with `YAMF_REGISTRY_TOKEN`; callers don't authenticate to each other except via application auth. The ed25519 keypairs from `createAuthService` (and the bundle‑signing identities from slice C tier 2) could underwrite **mTLS between nodes** without new key material. Not needed for homelab; becomes interesting when YAMF deploys across untrusted network segments.

### Gateway‑stable edge & registry continuity (horizon, theoretical)

**Motivation.** On bare metal, only one process can bind a given `IP:port`; k8s avoids that for *external* clients with a **Service** (stable DNS:port → changing pods). A similar **operator** story is: keep the **gateway** as the long‑lived public (or internal) edge that **pulls** registry state and proxies traffic; roll **registry + app services** behind it. That does **not** remove registry replacement complexity, but it **concentrates** downtime and migration risk on the control plane and cached topology, not on every client.

**Problem to solve (big rocks).**

1. **Gateway stays pull‑only.** The gateway must not become a second write path to registry truth. All authority stays on the registry; the gateway holds a **cache** from `REGISTRY_PULL` (and pushes / cache updates are already the fanout path). Any “continuity” feature must preserve that invariant.

2. **Fresh / empty registry vs last‑known good.** After a registry process is replaced, a pull can return **empty or partial** topology while services are still re‑registering. Without policy, the gateway could **flash** to an empty route table or route to nowhere. A **hold** (or “degraded serve last snapshot”) mode is needed: if the registry signals **unknown**, **draining**, or **rollout in progress**, or if the pull result is **implausibly empty** vs the previous snapshot, the gateway should **not** immediately replace a healthy cache with worse data.

3. **Minimize user‑visible downtime.** While the gateway keeps **last known** service locations, **services** should respond to normal lifecycle signals (`SERVICE_SHUTDOWN`, unregister, drain) so old replicas exit and new ones register quickly. The gateway can add **naive resilience**: short **backoff / retry** on proxied service or route errors when a pull (or response header) indicates **rollout** or **draining**, without turning the gateway into a message broker.

4. **Coordinating old ↔ new registry (and operator).** The **draining** peer is already initiated by `performRegistryDrainHandshake` in [`registry-drain-handshake.js`](../packages/core/src/registry/registry-drain-handshake.js). A fuller story may need an explicit **compatibility window**: e.g. new registry token, contract version, or breaking config known **before** cutover so the **old** registry (or a tiny sidecar) can signal **“prepare gateway for epoch B”** before the new instance is authoritative. That is orchestration‑layer work (scripts, systemd, or k8s Job order) as much as core code.

5. **Split‑brain.** Two sources of truth (stale gateway cache vs new registry, or two registries briefly both accepting registrations) is the main risk. **Mitigation sketch (happy path first):** assume **same topology + extended functionality** (backward‑compatible rollouts) as the default; optimize for that. A disciplined sequence reduces overlap: **hold** or serve last good → **drain and detach** old registrations on the old registry → **when** the new registry has a **complete enough** pull (or a explicit **epoch / generation** matches), **commit** the gateway cache to the new view. Push/cache‑update fanout already helps subscribers converge; the gateway’s job is to **avoid replacing good cache with empty** during that window.

**What “good enough prod” might look like without full replication:** stable gateway URL; internal stable registry URL (proxy, loopback, or DNS); registry rolling with drain + service re‑register; gateway policy that **defaults to last‑known routing** under uncertainty plus bounded retries. **Full state replication** between registry processes remains a larger step (see [multi‑region / multi‑registry federation](#multi‑region--multi‑registry-federation) above).

**Not committed.** No wire format or env names here — this section records **design intent** for when bare‑metal or “gateway‑first” deployments need stronger guarantees than “best effort pull after restart.”

---

## References (framework)

- `packages/core/src/shared/process-lifecycle.js`
- `packages/core/src/registry/registry-drain-handshake.js`
- `packages/core/src/registry/registry-server.js`
- `packages/core/src/registry/service-registry.js` (`broadcastShutdown`)
- `packages/core/src/registry/command-router.js` (slice F `registerCommand` lands here)
- `packages/core/src/registry/pubsub-manager.js` (`publishCacheUpdate`, slice E lands here)
- `packages/core/src/gateway/gateway-server.js` (startup readiness gate)
- `packages/core/src/service/cache-handler.js`
- `packages/core/src/api/create-service.js`
- `packages/core/src/api/create-subscription-service.js`
- `packages/core/src/api/create-event-source-service.js`
- `packages/core/src/shared/yamf-headers.js`
- `packages/cli/src/lib/pm3.js`
- `packages/cli/src/commands/{restart,drain,status}.js`
- `packages/services/pm3/service.js` (slice C `deploy` command lands here)
- `packages/services/file-server/service.js` (slice 1, slice B)
- `packages/services/file-upload/service.js` (slice B)
- `packages/client/src/Element.js` (slice 3 render‑context + listener emission)
- `packages/client/src/client-init.js` (slice 3 global `__listeners__` registry)
- `packages/client/src/patch-dom.js` (slice 3 morphdom hook for SSR patches)
- `packages/client/src/event-source.js` (slice 3 client‑side SSE receiver)
- `packages/core/tests/cases/rolling-registry-tests.js`
- `packages/core/tests/cases/ssr-handler-tests.js`
- `packages/cli/src/tests/cli-rolling-commands.js`

## References (apps)

- `soundclone-deployment/k3s/deployment.yaml`
- `soundclone-deployment/soundclone/src/app/app.js`
- `soundclone-deployment/soundclone/src/app/services/track-events.js`
