# YAMF — Rolling k3s Deployment Plan

Living document. Update phase status (`[ ]` → `[~]` → `[x]`) and append notes as work lands.

## Goals

Primary: **no‑downtime rolling k3s deployments** for SoundClone and any other YAMF stack.
Secondary: relevant YAMF CLI ergonomics improvements that benefit non‑k3s users (pm3, restart, drain).

## Status at a glance

| Phase | Scope | Status |
|---|---|---|
| 1 | Import soundclone patches → bump `@yamf/services-cache` to `0.1.4`, `@yamf/services-user` to `0.2.1` | [x] |
| 2 | Configurable static auth ed25519 keypair (persist under `.yamf/auth/`) | [x] |
| 3 | Multi‑session auth + `maxSessionsPerUser` + configurable access/refresh expiries | [x] |
| 4 | CLI: fix `0 services restarted` reporting + extend poll timings + env tunables | [x] |
| 5.1 | Centralize SIGTERM handling (single process lifecycle, not per‑service) | [ ] |
| 5.2 | Registry‑initiated `SERVICE_SHUTDOWN` broadcast | [ ] |
| 5.3 | Service‑side shutdown handler (validates registry token, unregisters, terminates) | [ ] |
| 5.4 | Dual‑registry drain protocol (`REGISTRY_DRAIN`) using existing `YAMF_REGISTRY_URL` + readiness probes | [ ] |
| 5.5 | Timing defaults + env overrides | [ ] |
| 5.6 | k3s manifest updates (accept one downtime window) | [ ] |
| 6   | Optional CLI polish (`yamf restart --rolling`, `yamf drain`, `yamf status --health`) | [ ] |

**Deferred (tracked, not planned in detail here):**
- Soundclone S3 lazy init — fixes startup flakiness with `yamf start`, companion to the below.
- Local FS expiration / resync system — makes the data/backend fully prod‑ready.

## Suggested merge order

1. Phase 1 — low risk, unblocks soundclone.
2. Phase 4 — small, independent, improves dev loop.
3. Phase 2 — self‑contained in auth service.
4. Phase 3 — depends on Phase 2 for configurable expiry plumbing.
5. Phase 5.1 — prerequisite refactor for the rest of Phase 5.
6. Phases 5.2–5.3 — needed for 5.4.
7. Phases 5.4–5.6 — ties no‑downtime work together.
8. Phase 6 — once the lifecycle and drain work is stable.

Ship Phases 1–4 as a single release train; Phase 5 as its own PR series with tests up front.

---

## Phase 1 — Import soundclone patches

Goal: delete `soundclone-deployment/soundclone/src/app/patches/` and make pnpm resolve to upstream YAMF packages that already contain the fixes.

### 1.1 `@yamf/services-cache@0.1.3` → `0.1.4`

Fix: `cacheSystem.del` must pass the key string/array through, not wrap it as `{ [key]: true }`, which silently breaks `@yamf/services-auth.logout`.

Source of the fix: `soundclone-deployment/soundclone/src/app/patches/@yamf+services-cache@0.1.3.patch`.

Apply at:

```268:276:yamf/packages/services/cache/service.js
  cacheSystem.set = (key, value) => cacheService({ set: { [key]: value } })
  cacheSystem.get = (key) => cacheService({ get: key })
  cacheSystem.setex = (key, value, expire) => cacheService({ setex: { [key]: value }, expire })
  cacheSystem.ex = (key, expire) => cacheService({ ex: { [key]: expire } })
  cacheSystem.getex = (key) => cacheService({ getex: key })
  cacheSystem.del = (key) => cacheService({ del: { [key]: true } })
  cacheSystem.clear = () => cacheService({ clear: true })
  cacheSystem.settings = (settings) => cacheService({ settings })
}
```

Replace the `del` line with:

```javascript
cacheSystem.del = (key) => cacheService({ del: key })
```

### 1.2 Tests

Add a regression test in `yamf/packages/services/cache/cache-tests.js`:
- `testBoundDelPassesRawKey` — `createInMemoryCache().set('foo', 1).del('foo')`, assert `.get('foo') === null`; then `.del(['a','b'])` path.

### 1.3 Version bump

`yamf/packages/services/cache/package.json`: `0.1.3` → `0.1.4`.

### 1.4 `@yamf/services-user@0.2.0` → `0.2.1`

Apply, in YAMF style, each hunk from `soundclone-deployment/soundclone/src/app/patches/@yamf__services-user@0.2.0.patch`.

**Buckets of change:**

1. **`expiresIn` override on invite**
   - `service.js > insertPendingInviteRow` — accept `expiresIn` in destructure, compute `expiryMs` with a 7‑day fallback.
   - `validators.js > _validateInvite` — add `expiresIn: is(is.optional, is.int({ positive: true }))`.
2. **Defensive `registerWithToken`**
   - Drop `let [users]` destructure; normalize shape with `Array.isArray` check.
   - Read both `isRegistered` / `is_registered` and `tokenExpires` / `token_expires` (snake_case fallback).
3. **`isTokenExpired` hardening** (`token.js`)
   - New private `toAbsoluteExpiryMs(raw)` handling `Date | string | number | bigint | null`, unix sec vs ms, ISO strings.
   - `isTokenExpired` returns `false` on unparseable input.
4. **PostGIS geography writes** (opt‑in, default off)
   - New config flag on `createUserService`: `postgisGeography: false`.
   - When `true`, `createOrValidateUserTable` + `syncUserTableSchema`:
     - `CREATE EXTENSION IF NOT EXISTS postgis` inside try/catch. On failure: log exact remediation ("PostGIS must be installed at the Postgres server / OS level first, e.g. `apt install postgis` or an equivalent image; restart the user service afterward") and throw.
     - Idempotent: `ALTER TABLE yamf.user ALTER COLUMN geolocation TYPE geography(Point,4326) USING geography(ST_GeomFromEWKT(geolocation))`.
   - Insert/update paths switch to the `CASE WHEN NULLIF(btrim(CAST(:geolocationEwkt AS TEXT)), '') IS NULL THEN NULL ELSE geography(ST_GeomFromEWKT(CAST(:geolocationEwkt AS TEXT))) END` pattern.
   - When `false` (default): current behavior (`geolocation TEXT`, plain `NULLIF` writes) — preserves portability for first‑time YAMF users without PostGIS.
   - Soundclone bootstrap sets `postgisGeography: true`.

Affected anchors:

```56:59:yamf/packages/services/user/service.js
function geolocationEwkt(longitude, latitude) {
  if (longitude == null || latitude == null) return null
  return `SRID=4326;POINT(${longitude} ${latitude})`
}
```

```168:236:yamf/packages/services/user/service.js
async function insertPendingInviteRow(sql, fields, config) {
  const {
    username = null,
    role = null,
    permissions = null,
    isActive = false,
    displayName = null,
    bio = null,
    location = null,
    avatarPath = null,
    invitedBy = null,
    latitude = null,
    longitude = null,
  } = fields

  const now = new Date().toISOString()
  const tokenData = await generateRegistrationToken(config.registrationToken.length)
  const tokenExpires = calculateTokenExpiry(config.registrationToken.defaultExpiry)?.toISOString() || null
```

```383:405:yamf/packages/services/user/service.js
  // Find user by iterating through users with tokens
  // (We can't query by token directly since it's hashed)
  let [users] = await sql(`
    SELECT user_id, username,
           token_hash,
           token_salt,
           token_expires,
           is_registered
    FROM yamf.user
    WHERE token_hash IS NOT NULL
  `, {})

  // Ensure users is an array
  if (!Array.isArray(users)) {
    users = users ? [users] : []
  }

  let matchedUser = null
  for (const user of users) {
    if (user.isRegistered) continue  // Skip already registered users

    // Check if token has expired
    if (isTokenExpired(user.tokenExpires)) continue
```

```55:66:yamf/packages/services/user/token.js
/**
 * Check if a token has expired
 * 
 * @param {Date|string|null} expiresAt - Expiration timestamp
 * @returns {boolean} True if expired (or if expiresAt is null, returns false)
 */
export function isTokenExpired(expiresAt) {
  if (!expiresAt) return false // No expiry set
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  return expiry < new Date()
}
```

### 1.5 Tests

Add to `yamf/packages/services/user/tests/`:
- `testInviteExpiresInOverride` — pass `expiresIn: 60_000`, assert `token_expires` ≈ `now + 60s`, and fallback to config when omitted.
- `testRegisterWithTokenSnakeCaseFallback` — simulate a data service returning `{ is_registered, token_expires }` instead of camelCase; registration still succeeds.
- `testIsTokenExpiredHandlesVariedShapes` — unit test `Date`, ISO, unix‑seconds number, unix‑ms number, bigint, ms‑string, sec‑string, null, garbage.
- `testPostgisGeographyFlagOffKeepsText` — default config, writing with lat/lon stores as TEXT.
- `testPostgisGeographyFlagOnWritesGeography` — when `true` and extension available, row geolocation column is `GEOGRAPHY(Point,4326)`; skipped when PostGIS unavailable in CI.
- `testPostgisGeographyFlagOnThrowsWithoutExtension` — mock `sql` to fail the `CREATE EXTENSION` step; assert thrown error message contains the remediation text.

### 1.6 Version bump

`yamf/packages/services/user/package.json`: `0.2.0` → `0.2.1`.

### 1.7 Soundclone integration

- Delete both files in `soundclone-deployment/soundclone/src/app/patches/`.
- Edit `soundclone-deployment/soundclone/src/app/package.json`:
  - Remove `pnpm.patchedDependencies` entirely.
  - `@yamf/services-cache`: `0.1.3` → `0.1.4`.
  - `@yamf/services-user`: `0.2.0` → `0.2.1`.
- Update soundclone's `createUserService` bootstrap to pass `postgisGeography: true`.
- `pnpm install` in `soundclone-deployment/soundclone/src/app/` to regenerate `pnpm-lock.yaml`.
- Smoke test: `pnpm run build` in `soundclone/frontend`, run backend, exercise invite + logout flows end‑to‑end.

---

## Phase 2 — Configurable static auth ed25519 keypair

Goal: keys survive redeploys so in‑flight refresh tokens keep working. Ephemeral keys become opt‑in (tests only).

### 2.1 New helper

Create `yamf/packages/core/src/utils/load-or-create-keypair.js`:

```javascript
export async function loadOrCreateEd25519Keypair({
  keyDir,
  keyName = 'default',
  privateKey,   // raw override (Buffer|string)
  publicKey,    // raw override
  ephemeral = false
}) { /* ... */ }
```

**Resolution order:**
1. `privateKey` / `publicKey` passed in — used directly.
2. `YAMF_AUTH_PRIVATE_KEY` / `YAMF_AUTH_PUBLIC_KEY` env (base64‑DER or PEM).
3. Disk: `${keyDir}/${keyName}.json` containing `{ publicKey, privateKey, createdAt, kid }` base64‑DER.
4. None of the above and `ephemeral === false` → generate, persist atomically (`writeFile` to `tmp` + `rename`, `chmod 600`), return.
5. `ephemeral === true` → generate in memory only.

`keyDir` default: `join(process.env.YAMF_HOME || join(process.cwd(), '.yamf'), 'auth')`.

### 2.2 Key id and token payload

- `kid = sha256(publicKey).slice(0, 16)`.
- Include `kid` in the token payload: `{ user, expire, kid, ...extra }`.
- Verification: accept tokens where `kid === currentKid`. Tokens without `kid` (legacy) verify only against the current key (today's behavior).

Prepares the ground for key rotation later without shipping rotation in this phase.

### 2.3 `createAuthService` changes

New options and defaults:

```javascript
export default async function createAuthService({
  serviceName = 'auth-service',
  useSessions = 'refresh-only',
  validateUserPassword = defaultValidateUser,
  enrichTokenPayload = null,

  // --- new in Phase 2 ---
  keyName = 'default',
  keyDir,               // default computed from YAMF_HOME
  privateKey,
  publicKey,
  ephemeral = false,

  // --- new (used in Phase 3 too) ---
  accessTokenExpiry = 60_000 * 30,        // 30 min
  refreshTokenExpiry = 60_000 * 60 * 24   // 24 hours
} = {}) { /* ... */ }
```

Replace:

```79:79:yamf/packages/services/auth/service.js
  const keyPair = await ed25519.generateKeyPair()
```

With:

```javascript
const keyPair = await loadOrCreateEd25519Keypair({
  keyDir, keyName, privateKey, publicKey, ephemeral
})
```

And pipe `accessTokenExpiry` / `refreshTokenExpiry` into the existing `defaultAccessTokenExpireTime` / `defaultRefreshTokenExpireTime` locals (replacing the hardcoded `60000 * 30` / `60000 * 60 * 24`).

### 2.4 Tests

Add to `yamf/packages/services/auth/auth-tests.js`:
- `testAuthServiceStaticKeysPersistAcrossRestart` — `keyDir: tmp` with `ephemeral: false`; log in; terminate; start a fresh auth service pointed at the same `keyDir`; the original access token still verifies.
- `testAuthServiceEphemeralKeysRotateOnRestart` — negative case; `ephemeral: true` rotates keys, old token returns `401`.
- `testAuthServiceEnvKeyOverride` — `YAMF_AUTH_PRIVATE_KEY` / `_PUBLIC_KEY` take precedence over disk.
- `testAuthServiceConfigurableExpiries` — see Phase 3 expansion.

### 2.5 Deployment

Soundclone k3s manifest: mount a volume at `/app/.yamf` (hostPath or PVC) on every pod that hosts `auth-service`. Single source of auth keys across pod restarts.

---

## Phase 3 — Multi‑session auth + `maxSessionsPerUser`

Goal: a user can hold multiple valid refresh/access tokens (phone, desktop, tablet) regardless of `useSessions` mode. Expiries and session caps are explicit configuration.

### 3.1 Cache key shape change

Today, in `yamf/packages/services/auth/service.js`, storage is per‑user (one slot):

```120:125:yamf/packages/services/auth/service.js
    if (useSessions) {
      cache.setex(`${payload.user}:refresh-token`, refreshToken, defaultRefreshTokenExpireTime)
      if (useSessions !== 'refresh-only') {
        cache.setex(`${payload.user}:access-token`, accessToken)
      }
    }
```

New shape — **per‑token**:
- `refresh:${tokenId}` → `{ user, createdAt, metadata }`
- `access:${tokenId}` → `{ user, createdAt }`
- `tokenId = sha256(encodedTokenString).slice(0, 16)` — never stores the raw token.

### 3.2 Flow changes

- **`authenticate`** — always mints a new token pair; never deletes existing sessions. Stores new entries per the `useSessions` mode.
- **`verifyAccessToken`** — when `useSessions === true`, look up by `access:${tokenId}` instead of `${user}:access-token`.
- **`getNewAccessToken`** — when sessions enabled, look up `refresh:${tokenId}` of the supplied cookie's token. Any matching refresh is fine.
- **`logout`** — delete only the caller's `refresh:${tokenId}` and (if applicable) `access:${tokenId}` pair. New optional `logoutAll: true` body flag iterates `cache.get('*')`, deletes entries whose `.user === caller`.

### 3.3 `maxSessionsPerUser`

- New option on `createAuthService`: `maxSessionsPerUser` (default `null` = unlimited).
- On successful `authenticate` with `useSessions` truthy:
  - Count existing `refresh:*` entries whose value `.user === payload.user`.
  - If count ≥ limit, evict oldest by `createdAt` until count == limit − 1 before inserting the new one.

### 3.4 `sessionMetadataFn` hook

Optional. `sessionMetadataFn(payload, request) => { ua, ip, device }` — stored alongside the entry so future UI can render "active sessions".

### 3.5 Tests

Extend `auth-tests.js`:
- `testMultipleConcurrentSessions_Stateless` — `useSessions: false`; two logins; both access tokens verify; logout is a no‑op.
- `testMultipleConcurrentSessions_RefreshOnly` — `useSessions: 'refresh-only'`; two logins; each can refresh; logout kills only caller's refresh.
- `testMultipleConcurrentSessions_Full` — `useSessions: true`; both access tokens verify in parallel; logout clears only the caller's pair.
- `testLogoutAllEndsAllSessionsForUser`.
- `testMaxSessionsPerUserEvictsOldest` — limit `2`, login 3x, oldest refresh now returns `401`.
- `testConfigurableExpiriesShorten` — `accessTokenExpiry: 50`, `sleep(100)`, verify → `401 Expired access token`.
- `testSessionMetadataFnAttachesFields` — metadata present in cache entry.

### 3.6 Backwards compatibility

Token payload shape is unchanged aside from the new `kid` from Phase 2. Existing clients keep working; only the server‑side cache key strategy changes.

---

## Phase 4 — CLI `restart` count fix + timing

Two distinct bugs plus some tunability.

### 4.1 Bug: "0 services restarted" after registry restart

```429:473:yamf/packages/cli/src/lib/pm3.js
  async restartWithRegistry(state, registryKeys, options) {
    logger.warn('Registry restart detected — all services must be restarted to replenish registry state')

    const registryEntry = state.processes[registryKeys[0]]

    const dependentEntries = []
    for (const key of Object.keys(state.processes)) {
      if (registryKeys.includes(key)) continue
      const entry = state.processes[key]
      dependentEntries.push({ key, ...entry })
    }

    for (const dep of dependentEntries) {
      if (dep.pid && isProcessAlive(dep.pid)) {
        try { await this.stopOne(dep.key) } catch { /* best effort */ }
      }
    }
    for (const key of registryKeys) {
      const entry = state.processes[key]
      if (entry?.pid && isProcessAlive(entry.pid)) {
        try { await this.stopOne(key) } catch { /* best effort */ }
      }
    }

    await sleep(500)

    logger.info('Restarting registry...')
    await this.start(registryEntry.filepath, { internal: registryEntry.internal || false, ...options })
    await sleep(500)

    const results = []
    for (const dep of dependentEntries) {
      if (dep.status === 'stopped' && !dep.pid) continue
      logger.info(`Restarting ${dep.filepath}...`)
      try {
        const result = await this.start(dep.filepath, { internal: dep.internal || false, ...options })
        results.push(result)
      } catch (err) {
        logger.error(`Failed to restart ${dep.filepath}: ${err.message}`)
      }
    }

    logger.info(`Registry and ${results.length} service(s) restarted`)
    return results
  }
```

Fix:
- Track `{ registry, services: [], failed: [] }` counters.
- Return the shape `{ registry, services, failed }` — not a bare `results` array.
- Log `Registry restarted; ${services.length}/${dependentEntries.length} service(s) restarted${failed.length ? ` (${failed.length} failed)` : ''}`.

Update `yamf/packages/cli/src/commands/restart.js:runRestartCommand` to print an accurate count when `--all`:

```41:50:yamf/packages/cli/src/commands/restart.js
  if (options.all) {
    const entries = await pm3.list({ all: true })
    for (const entry of entries) {
      if (entry.status === 'running') {
        try { await pm3.restart(entry.filepath) } catch { /* best effort */ }
      }
    }
    logger.info('All processes restarted.')
    return
  }
```

→ count successes/failures and log `Restarted N of M process(es)`.

### 4.2 Bug: `pollUntilNoNewServices` gated by `lastLength > 0`

```322:339:yamf/packages/cli/src/lib/pm3.js
  async pollUntilNoNewServices(beforeSnapshot, { maxAttempts = 80, intervalMs = 125, consecutiveChecksRequired = 3 } = {}) {
    let lastLength = 0
    let consecutiveChecks = 0
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(intervalMs)
      try {
        const afterSnapshot = await getServiceStateSnapshot(this.registryUrl)
        const services = detectNewServices(beforeSnapshot, afterSnapshot)
        if ((lastLength > 0) && lastLength == Object.keys(services).length) consecutiveChecks++
        if (consecutiveChecks >= consecutiveChecksRequired) return services
        lastLength = Object.keys(services).length
      } catch {
        // registry may have just started, or the process is still booting
      }
    }
    logger.warn('No new services detected after polling — process may not register any services')
    return {}
  }
```

Issue: `(lastLength > 0)` short‑circuits even when services have stably registered at zero delta. A single‑service process that registers on the first poll spins the full `maxAttempts × intervalMs` (10 s) before returning.

Fix: compare `services` count against previous iteration regardless of magnitude; drop the `lastLength > 0` guard.

### 4.3 Timing bumps + env tunables

- `pollUntilNoNewServices` defaults: `intervalMs: 200`, `maxAttempts: 150` (30 s ceiling), `consecutiveChecksRequired: 3`.
- Env overrides:
  - `YAMF_PM3_POLL_MAX_ATTEMPTS`
  - `YAMF_PM3_POLL_INTERVAL_MS`
  - `YAMF_PM3_POLL_STABLE_CHECKS`
- `stopOne` SIGTERM grace loop bumped from 10 × 200 ms to 20 × 250 ms (5 s) to allow services a longer window to unregister cleanly:

```359:369:yamf/packages/cli/src/lib/pm3.js
    let dead = false
    for (let i = 0; i < 10; i++) {
      await sleep(200)
      if (!isProcessAlive(pid)) { dead = true; break }
    }

    if (!dead) {
      logger.warn(`Process ${pid} did not exit after SIGTERM, sending SIGKILL`)
      try { process.kill(pid, 'SIGKILL') } catch { /* already dead */ }
      await sleep(100)
    }
```

### 4.4 Tests

New `yamf/packages/cli/src/tests/pm3-restart-tests.js`:
- `testRestartAllReportsAccurateCount` — three trivial services; run `runRestartCommand(['--all'])`; assert stdout matches `Restarted 3 of 3 process(es)`.
- `testRestartRegistryIncludedInCount` — unit test on the shape returned by `restartWithRegistry`.
- `testPollUntilNoNewServices_HappyPath` — stubbed `getServiceStateSnapshot`; returns in `~ consecutiveChecksRequired × intervalMs`, not `maxAttempts × intervalMs`.

---

## Phase 5 — Rolling k3s deployment support

Split into six sub‑phases so we can merge incrementally. All additive; must not break single‑replica behavior.

### 5.1 Centralize SIGTERM handling

**Problem.** Every service attaches its own listener:

```262:265:yamf/packages/core/src/api/create-service.js
  process.once('SIGTERM', async () => {
    logger.debug('SIGTERM received for service', name)
    await server.terminate()
  })
```

```228:232:yamf/packages/core/src/api/create-subscription-service.js
  process.once('SIGTERM', async () => {
    logger.debug('SIGTERM received for service', serviceName)
```

```359:363:yamf/packages/core/src/api/create-event-source-service.js
  process.once('SIGTERM', async () => {
    logger.debug('SIGTERM received for service', serviceName)
```

A process with a registry and ~10 services trips Node's default `MaxListenersExceededWarning` and gives no ordering guarantee between terminables.

**Solution.** Create `yamf/packages/core/src/shared/process-lifecycle.js`:

```javascript
const terminables = new Set()
let installed = false
let shutdownInFlight = false

export const lifecycle = {
  registerTerminable(fn, { priority = 10 } = {}) { /* sorted insert, install signal handlers once */ },
  unregisterTerminable(fn) { /* ... */ }
}

async function runShutdown(reason) {
  if (shutdownInFlight) return
  shutdownInFlight = true
  const timeoutMs = envConfig.get('YAMF_GRACEFUL_SHUTDOWN_MS', 15000)
  for (const t of [...terminables].sort((a, b) => b.priority - a.priority)) {
    await Promise.race([t.fn(), sleep(timeoutMs)])
  }
}

function install() {
  if (installed) return
  installed = true
  process.once('SIGTERM', () => runShutdown('SIGTERM'))
  process.once('SIGINT',  () => runShutdown('SIGINT'))
}
```

- Services register via `lifecycle.registerTerminable(server.terminate, { priority: 10 })`.
- Registry and gateway register with `priority: 0` so they drain **last**.
- Each service's manual `terminate()` path calls `unregisterTerminable` first to avoid double‑invocation.

Remove the three `process.once('SIGTERM', …)` sites listed above; replace with `lifecycle.registerTerminable` calls.

**Test:** `testSIGTERM_SingleListenerAcrossManyServices` — create 10 services in one process, assert `process.listenerCount('SIGTERM') <= 2`.

### 5.2 Registry broadcast shutdown

Goal: on registry SIGTERM, actively tell all registered services to self‑terminate. Belt & suspenders for 5.4.

- Add header/command constants in `yamf/packages/core/src/shared/yamf-headers.js`:
  - `COMMANDS.SERVICE_SHUTDOWN = 'service-shutdown'`
  - `buildShutdownHeaders(serviceName, location, registryToken, reason)`.
- In `yamf/packages/core/src/registry/service-registry.js`, add `broadcastShutdown(state, { reason })`:
  - For each `(service, locations)` in `state.services`, fire `httpRequest(location, { headers: buildShutdownHeaders(…) })` concurrently.
  - Skip services with `accessControl === 'pure'` (no HTTP server).
  - Per‑call timeout: `YAMF_SHUTDOWN_BROADCAST_TIMEOUT_MS` (default `2000`).
- In `registry-server.js` `server.terminate`, call `broadcastShutdown(state, { reason: 'registry-shutdown' })` **before** `httpServerTerminate()`.
  - Gate with `options.broadcastShutdownOnTerminate` (default `true`; tests flip off).

### 5.3 Service‑side shutdown handler

Goal: a service can be told by its registry to self‑terminate safely.

- In the service request path (new `yamf/packages/core/src/service/service-command-handler.js` or an extension of `cache-handler.js`), intercept **before** user code:
  1. If `headers[HEADERS.COMMAND] === COMMANDS.SERVICE_SHUTDOWN`:
     - `validateRegistryToken(request)` (shared helper from `registry-auth.js`).
     - Respond `202 Accepted`.
     - `queueMicrotask` → `server.terminate()` which already calls `unregisterServiceFromRegistry` + `httpServerTerminate`. Swallow `ECONNREFUSED` on unregister (registry may be going away too).
- Pattern mirrors today's `CACHE_UPDATE` interceptor. Extend any existing "internal commands" set (currently `cache-update`) to include `service-shutdown`.

Test: `testServiceShutdownCommandValidatesRegistryToken` — bad token → `401`; good token → `202`, process-visible terminate.

### 5.4 Dual‑registry drain protocol

Uses only existing `YAMF_REGISTRY_URL` — no new env var. Relies on k3s readiness probes keeping R2 out of Service endpoints until it's ready.

**Protocol:**

1. R2 starts; readiness probe keeps Service DNS pointing at R1.
2. Inside `createRegistryServer`, **before** binding the health port:
   - `registryInstanceId = randomUUID()`.
   - Send `REGISTRY_DRAIN` → `YAMF_REGISTRY_URL`, headers include `yamf-registry-instance-id: <R2 id>` and a valid `yamf-registry-token`.
   - Possible outcomes:
     - Timeout / connection refused / no DNS → we are the first registry; proceed as normal.
     - `200 OK` with a *different* instance id in response header → handoff accepted; proceed.
     - `400` because target id matches our own → we somehow reached ourselves; treat as first registry.
3. R1 on receiving `REGISTRY_DRAIN`:
   - Validates registry token.
   - If drainer id == own id → `400`.
   - Else set `state.draining = true`; start rejecting `SERVICE_SETUP` / `SERVICE_REGISTER` with `503 Retry-After: ⌈YAMF_DRAIN_MS/1000⌉ + 1`.
   - **Continues to serve:** `SERVICE_CALL`, `SERVICE_LOOKUP`, `SERVICE_UNREGISTER`, `REGISTRY_PULL`, `HEALTH`, `PUBSUB_*`.
   - Does **not** self‑kill — waits for k3s SIGTERM.
4. R2 finishes init, passes readiness, joins Service endpoints. DNS flips.
5. Services whose registration hit R1 with `503` fall through existing retry (`retry-helper.js`); DNS now resolves to R2; registration succeeds there.
6. k3s SIGTERMs R1. Phase 5.1 lifecycle runs, then Phase 5.2 `broadcastShutdown` catches any stragglers, then HTTP server closes.

**New constants:**
- `COMMANDS.REGISTRY_DRAIN = 'registry-drain'`
- `HEADERS.REGISTRY_INSTANCE_ID = 'yamf-registry-instance-id'`

**Tests in `yamf/packages/core/tests/integration/rolling-registry-tests.js`:**
- `testDrainingRegistryReturns503WithRetryAfter`
- `testDrainingRegistryKeepsServingReadsAndCalls` — SERVICE_CALL, SERVICE_LOOKUP, SERVICE_UNREGISTER, REGISTRY_PULL all OK while draining.
- `testServiceReregistersWithNewRegistryAfterDrain` — R1 up, service S, start R2; assert R2 eventually contains S via retry path.
- `testShutdownBroadcastTerminatesServices` — terminate registry, assert services unregister ≤ drain timeout.
- `testNoDowntimeRollingRegistryHandoff` — burst of SERVICE_CALL traffic with R2 mid‑start; zero failed calls once retry helper engages.
- `testFfmpegScaleUpDownUpdatesRegistryLocations` — register two ffmpeg instances, unregister one, assert load balancer routes only to survivor.
- `testSelfDrainRefused` — registry receiving DRAIN with matching instance id → `400`.

### 5.5 Timing defaults + env overrides

| Env var | Default | Meaning |
|---|---|---|
| `YAMF_GRACEFUL_SHUTDOWN_MS` | `15000` | lifecycle timeout per terminable. |
| `YAMF_DRAIN_MS` | `3000` | grace period a draining registry waits before hard shutdown (advisory — k3s actually times it out). |
| `YAMF_SHUTDOWN_BROADCAST_TIMEOUT_MS` | `2000` | per‑service wait for `SERVICE_SHUTDOWN`. |
| `YAMF_REGISTRATION_RETRY_LIMIT` | `50` → `120` | extra retries to bridge a registry gap. |
| `YAMF_RETRY_DELAY` | `20` → `100` | less thundering herd on registry. |
| `YAMF_PM3_POLL_MAX_ATTEMPTS` | `150` | Phase 4 CLI polling. |
| `YAMF_PM3_POLL_INTERVAL_MS` | `200` | Phase 4 CLI polling. |
| `YAMF_PM3_POLL_STABLE_CHECKS` | `3` | Phase 4 CLI polling. |

All read via existing `envConfig.get(name, defaultValue)` pattern.

### 5.6 k3s manifest updates

One‑time edit to `soundclone-deployment/k3s/deployment.yaml`:
- Registry, gateway, app deployments:
  - `strategy: RollingUpdate { maxUnavailable: 0, maxSurge: 1 }`.
  - `terminationGracePeriodSeconds: 30`.
  - `readinessProbe` already present on registry/gateway (`tcpSocket` on port) — keep; ensure it's tight enough that the drain call happens before R2 is marked ready.
- Auth key persistence (Phase 2): add a hostPath or PVC volume at `/app/.yamf` on pods that run `auth-service`.
- **No preStop hook** — drain is driven entirely by R2's startup call.
- **Accept one downtime window** when this manifest is first applied; future redeploys are rolling‑safe.

---

## Phase 6 — CLI polish (optional, after Phase 5)

Small wins once 5 lands:
- `yamf restart --rolling <target>` — spawn replacement, wait for it to register, SIGTERM the old instance (pm3 already tracks `path#N`).
- `yamf drain` — issue `REGISTRY_DRAIN` to the tracked registry without killing it (for inspection / pre‑deploy prep).
- `yamf status --health` — surface `state.draining` and active service counts.

---

## ffmpeg scaling (already covered)

No new work required for Phase 5 to support scaling `ffmpeg-service` replicas:
- **Scale up:** new pod runs `SERVICE_SETUP` → `SERVICE_REGISTER`; registry appends the location to `state.services.get('ffmpeg-service')`; load balancer picks it up on next call.
- **Scale down:** SIGTERM → Phase 5.1 lifecycle → `server.terminate` runs `unregisterServiceFromRegistry` → registry removes the location → notifies gateway; in‑flight HTTP calls drained by the HTTP server shutdown grace.
- **During registry rollover:** `SERVICE_UNREGISTER` is explicitly allowed through a draining registry (not in the 503 list), so scale‑down during a deploy cleans up correctly.

Covered by `testFfmpegScaleUpDownUpdatesRegistryLocations` in Phase 5.4.

---

## Deferred

Tracked here, not planned in detail yet:

### Soundclone S3 lazy init
Swap synchronous S3 bring‑up for lazy‑on‑first‑call. Expected side benefit: fixes `yamf start` startup flakiness since services no longer block on S3.

### Local FS expiration / resync system
Companion to the S3 lazy init. Cache eviction policies, S3‑of‑record reconciliation, orphan cleanup. Needs its own design pass.

---

## References

- `soundclone-deployment/soundclone/src/app/patches/@yamf+services-cache@0.1.3.patch`
- `soundclone-deployment/soundclone/src/app/patches/@yamf__services-user@0.2.0.patch`
- `yamf/packages/services/cache/service.js`
- `yamf/packages/services/user/service.js`
- `yamf/packages/services/user/token.js`
- `yamf/packages/services/user/validators.js`
- `yamf/packages/services/auth/service.js`
- `yamf/packages/services/auth/auth-tests.js`
- `yamf/packages/cli/src/lib/pm3.js`
- `yamf/packages/cli/src/commands/restart.js`
- `yamf/packages/core/src/api/create-service.js`
- `yamf/packages/core/src/api/create-subscription-service.js`
- `yamf/packages/core/src/api/create-event-source-service.js`
- `yamf/packages/core/src/registry/registry-server.js`
- `yamf/packages/core/src/registry/command-router.js`
- `yamf/packages/core/src/registry/service-registry.js`
- `yamf/packages/core/src/registry/registry-auth.js`
- `yamf/packages/core/src/shared/yamf-headers.js`
- `yamf/packages/core/src/shared/retry-helper.js`
- `yamf/packages/core/src/api/service-helpers.js`
- `soundclone-deployment/k3s/deployment.yaml`
