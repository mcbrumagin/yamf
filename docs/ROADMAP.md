# YAMF Roadmap

Living document. Framework‑level plans (YAMF) live here; product roadmaps for specific apps live alongside the app.

**Cross‑repo goals driving the near‑term work:**

- Fully hot‑reloaded development experience — **including when working against remote dev services**.
- Rolling production deployments **with and without k3s**, driven by the framework itself rather than the cluster.
- Keep the framework **system‑agnostic**: k8s, bare‑metal pm3 nodes, and local dev should all share the same primitives.

## Index

- **This doc** — YAMF framework plan (what shipped + active slices + deferred).
- **SoundClone product roadmaps** (under `soundclone-deployment/docs/`):
  - [Immediate & near‑term (alpha → ~6 months)](../../soundclone-deployment/docs/ROADMAP-IMMEDIATE-NEAR-TERM.md)
  - [Cloud‑hosted & community release (~6 months → later)](../../soundclone-deployment/docs/ROADMAP-CLOUD-HOSTED.md)
  - [Reliable background playback / HLS design notes](../../soundclone-deployment/docs/ROADMAP-BACKGROUND-PLAYBACK-HLS.md)

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

Regression coverage lives in `packages/core/tests/cases/rolling-registry-tests.js`, `packages/core/tests/cases/ssr-handler-tests.js`, and `packages/cli/src/tests/cli-rolling-commands.js`.

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

---

## Active follow‑on work (framework)

Slice labels (A–F) are **stable identifiers**; the order slices appear in below is the **recommended execution order**. Sizes in brackets are rough t‑shirts. Slices are individually shippable; apps with app‑specific pressure (e.g. Soundclone needing B before C) can reorder without blocking framework work.

### Recommended execution order

**Phase 1 — low‑risk plumbing, parallel‑safe:**

1. **E** — coalesced bulk cache updates. Ship **first** so slice C's deploy storms don't land on top of a known fanout bottleneck.
2. **F** — registry `registerCommand` extension point. Prerequisite for C's `deploy-router` to live as a plugin rather than in core; validates the plugin model on its most load‑bearing consumer.
3. **A** — CSP / security header defaults. Independent of the orchestrator story; small; blocks nothing.
4. **B** — upload / path protection. Similar size to A; promote earlier if app‑side upload exposure predates remote deploy (Soundclone case).

**Phase 2 — orchestrator groundwork (local only):**

5. **C1** — `yamf build` + bundle cache.
6. **C2** — `yamf deploy --local`. Must propagate `YAMF_SOURCE_HASH` to service env so every registration records it in `metadata.sourceHash` (unlocks `yamf status --versions`, rollback data, and audit from day one).
7. **Cross‑cut 1** — secrets / config separation (`config-service` scaffolding). **Hard gate on C3**; shipping remote deploys without config separation bakes in "secrets live in the bundle" as precedent, which is a one‑way door.
8. **Cross‑cut 6** — dev/prod parity design review. Not a slice, a one‑time gate before C3 / D1 ship: confirm `yamf dev`, `yamf deploy --local`, and `yamf deploy --remote` reach the **same** codepath with different defaults.

**Phase 3 — remote rollout:**

9. **D1** — `yamf dev` + watch + local redeploy (can start the moment C2 lands; overlaps with C3 handoff).
10. **C3** — `pm3-service deploy` + registry bundle store + single‑node remote deploy (gated on cross‑cut 1).
11. **C4** — multi‑node placement + rolling.
12. **C5** — hash‑same‑as‑scale / hash‑diff‑as‑rollout + rollback.
13. **Cross‑cut 2** — contract‑aware rolling (pairs with C5).
14. **Cross‑cut 3** — deploy audit + observability (accrues across C3–C5).

**Phase 4 — polish & production hardening:**

15. **D2** — `@yamf/dev-hmr` SSE + client.
16. **D3** — Vite plugin bridge.
17. **C6** — ed25519 signed bundles + admin‑auth.
18. **Cross‑cut 5** — canary / percentage rollouts.
19. **Cross‑cut 4** — auto‑re‑placement on replica loss.
20. **D4** — `applyPatch` state‑preserving HMR.

### Slice E — Coalesced bulk cache updates  `[small/medium]`

**Goal.** Replace the "one HTTP call per subscriber per registration" fanout with "one HTTP call per subscriber per coalesce window, carrying N updates". Directly addresses the update‑fanout bottleneck identified in the Scale envelope below, without changing any subscriber‑visible semantics beyond a small latency shift and an optional bulk wire shape.

**Why first.** It's the cheapest scalability win available: a ~200 LOC patch to `packages/core/src/registry/pubsub-manager.js` + `packages/core/src/service/cache-handler.js`, zero topology change, zero trust‑model change. Landing it before slice C means the orchestrator's deploy storms never hit the flat‑fanout wall.

**Design commitments:**

1. **Buffered dispatch.** `publishCacheUpdate` stops firing HTTP calls inline. Instead it appends `{ subscription, service, location, contract }` to a per‑subscriber pending list and arms (or resets) a debounce timer.
2. **Debounce semantics.**
   - `YAMF_CACHE_COALESCE_MS` (default `50`): flush this many ms after the **last** queued update.
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

### Slice F — Registry command extension point  `[tiny]`

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

### Slice A — Content‑Security‑Policy & default security headers  `[small]`

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

### Slice B — Enhanced upload & path protection  `[small/medium]`

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
- **C6** — ed25519 signed bundles + admin‑auth instance.

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

4. **Vite / SPA integration.** For apps like Soundclone that use Vite: a small `vite-plugin-yamf-dev` in `packages/client/src/vite-plugin.js` that forwards Vite HMR events onto `yamf:dev-reload`. Result: **one** reload transport for both server services and SPA bundles.

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
   - **D3** — Vite plugin bridging.
   - **D4** — `applyPatch` hook for state‑preserving reloads (depends on slice 3 `broadcastRender` being adopted by the app).

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

### Lower‑priority cleanup (tracked, not blocked on slices A–E)

- `createService` and `createSubscriptionService` both branch into a pure variant with duplicate lifecycle plumbing. Extract `createLocalService({ name, handler, access, cache, context, pubSubManager? })` so public factories only describe type‑specific bits.
- `createService`'s `pureServiceWrapper` can drop the `undefined` sentinel once `before()` is first‑class on `createPureService`.
- `createPureSubscriptionService` double‑logs "Pure subscription service … registered" on the `local-logger` path; collapse.
- `notifyRegistryOfPureService` silently returns `null` on failure; either bubble up or add explicit `suppressRegistryWarning`.

---

## Towards 1.0

YAMF's identity shifts with slices C + D: from "service framework with rolling support" to **"small, system‑agnostic orchestrator that also happens to be a service framework"**. A 1.0 bar worth committing to:

- **Ships:** slices A, B, C (through C5), D (through D3), E, F, and all six cross‑cutting concerns above.
- **Doesn't ship yet:** federation / multi‑registry gossip, cascade fan‑out (see Deferred), non‑JS bundle deploys, mTLS between nodes (tokens + signed bundles remain primary), `applyPatch` state‑preserving HMR (D4).
- **Story:** a single binary (`yamf`) takes you from `yamf init` to `yamf dev` to `yamf deploy --remote`, on k3s **or** a fleet of plain VMs, with rolling + rollback + contracts + secrets management, zero vendor dependencies.
- **Plugin model formalized.** Already mostly true — `@yamf/services-*` packages are plugins today. At 1.0, name it explicitly: **core is a tiny kernel** (registry state, gateway routing, HTTP primitives, pub/sub, lifecycle); **everything else is a service** that can be swapped or omitted. Concretely:
  - **Always‑there kernel:** `create-service`, `create-route`, `create-subscription-service`, `create-event-source-service`, registry, gateway, pub/sub, lifecycle, call‑service, HTTP primitives.
  - **Default‑but‑replaceable:** rate‑limiter (in‑process today; expose `createRateLimiterService` wire so apps can swap in Redis/etc.), `simpleSecurityCheck`, auth‑via‑token.
  - **Optional services** (all plain YAMF services; mix and match): `config-service`, `secrets-service`, `deploy-router` (slice C), `dev-hmr-service` (slice D), `metrics-service`, `audit-service`, `schema-registry-service`, `queue-service`, `scheduler-service`, `blob-service`, `notify-service`.
  - **Registry extension point (small, high‑leverage):** `registerCommand(name, handler)` on the registry command router so a plugin service (e.g. `deploy-router`, `schema-registry`) can add new `yamf-command:` verbs without editing core. **Shipping as [Slice F](#slice-f--registry-command-extension-point--tiny)** — first consumer is slice C's deploy router, which validates the plugin API on its most load‑bearing real‑world case.
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

**First real bottleneck is update fanout, not memory.** `publishCacheUpdate` hits every non‑pure subscriber on every registration. A whole‑fleet deploy of N services with R replicas per service costs roughly **N × (N × R)** HTTP calls at the registry. Memory stays small long after fanout starts hurting.

Mitigations, in order of diminishing returns:

- **Coalesced bulk cache updates → promoted to [Slice E](#slice-e--coalesced-bulk-cache-updates--smallmedium).** Single flag, no topology change; cuts outbound calls by roughly the window batch size.
- **Lazy cache pull on first call** — services start with an empty cache and pull on the first `callService('foo')` miss; the full‑fanout path becomes optional (`YAMF_EAGER_CACHE=on` for today's behavior). Small patch, plays nicely with E.
- **Cascade fan‑out of cache updates** — see below; meaningful only once E + lazy pull are in and the registry is **still** the bottleneck.
- **Sharded registries** (dovetails with federation above) — partition by service name prefix or tenant; each registry authoritative for its shard.
- **Contract size cap** — warn if a contract grows past e.g. 8 KB; encourage `contract-ref` to a hash in a schema registry once cross‑cut 2 lands.

### Cascade fan‑out of cache updates  `[horizon, post‑E]`

**Goal.** Beyond coalescing, distribute the fan‑out work itself. The registry stops being responsible for 100% of outbound cache‑update calls; a subset of recipients forward to their peers, halving (or better) registry egress in exchange for slightly more topology state per window.

**Not a 1.0 item.** Slice E alone likely defers this by an order of magnitude of scale (think "thousands of services, tens of thousands of replicas"). The design sketch below is deliberately fleshed out so it's clear which half is worth doing first if we ever reach the bottleneck.

**High‑level shape:**

1. **Coalesce first** (requires slice E) — cascade only kicks in when a window would hit more than `YAMF_CASCADE_MIN` recipients (default `64`). Small fleets stay on flat fanout; no added complexity.
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
