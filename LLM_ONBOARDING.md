# LLM Onboarding - YAMF Development Guide

This document provides AI assistants with essential context for working on the YAMF codebase. It covers coding conventions, testing patterns, and architectural concepts.

For **test runner defaults**, **`withEnv` vs `.env.test`**, **`registryServer` / ports**, and **filter gotchas**, see **`docs/TESTING.md`**.

## Project Overview

YAMF (Yet Another Microservice Framework) keeps **`@yamf/core`** free of npm dependencies at runtime (zero third-party packages for the server stack). Optional packages (e.g. **`@yamf/client`**) add their own dependencies (e.g. **morphdom**). The codebase prioritizes:
- Pure Node.js implementation for core server runtime (no external npm deps in `@yamf/core`)
- Modular, composable architecture
- Comprehensive testing with meaningful assertions
- Clear separation between registry, gateway, and services

## Testing Conventions

### Core Testing Utilities

Import from `@yamf/test`:

```javascript
import {
  assert,
  assertErr,
  assertEach,
  assertSequence,
  sleep,
  terminateAfter,
  withEnv
} from '@yamf/test'
```

### Integration Test Pattern

**Always use `terminateAfter` as the main entry point for integration tests.** It manages server lifecycle (startup and shutdown) automatically.

```javascript
export async function testMyFeature() {
  await terminateAfter(
    () => registryServer(), // thunks — do not await; see packages/test/README.md (terminateAfter)
    () => gatewayServer(),
    () => createService('my-service', handler, options),
    async (registry, myService, gateway) => {
      // Test logic — server instances are passed in order as arguments
      assert(result,
        r => r.status === 'ok',
        r => r.data !== undefined
      )
    }
  )
}
```

**Key points:**
- Pass **thunks** (`() => serverPromise`) so startup runs in order; do not `await` servers before `terminateAfter` (see `packages/test/src/helpers.js`).
- The callback receives resolved servers in the same order.
- Teardown is automatic after the test (success or failure).

### Multi-Assertion Pattern

**Prefer multiple assertions over single assertions.** This provides comprehensive failure debugging when tests fail.

```javascript
// GOOD: Multiple assertions show all failures at once (the anonymous functions are printed out)
assert(user,
  u => u.name === 'Alice',
  u => u.age > 18,
  u => u.active === true,
  u => u.permissions.includes('read')
)

// AVOID: Single assertions require multiple test runs to find all issues
// This is also less clear what we are testing in the output since we access the property before the assertion function
assert(user.name, n => n === 'Alice')
assert(user.age, a => a > 18)
assert(user.active, a => a === true)

// These would be acceptable versions if these were all in separate tests (or on different data)
assert(user, u => u.name === 'Alice')
assert(user, u => u.age > 18)
assert(user, u => u.active === true)

// This is ideal, for the same user data
assert(user,
  u => u.name === 'Alice',
  u => u.age > 18,
  u => u.active === true
)
```

### Assertion Functions

#### `assert(value, ...predicates)`
Assert on a value with one or more predicate functions:

```javascript
assert(response,
  r => r.status === 200,
  r => r.body !== null,
  r => Array.isArray(r.items)
)
```

#### `assertErr(fnOrError, ...predicates)`
Assert that a function throws (or is an error) with specific properties:

```javascript
await assertErr(
  async () => httpRequest(url, { unauthorized: true }),
  err => err.status === 403,
  err => err.message.includes('forbidden')
)
```

#### `assertEach(array, ...predicates)`
Assert all items in an array pass all predicates:

```javascript
assertEach(users,
  u => u.id !== undefined,
  u => typeof u.name === 'string'
)
```

#### `assertSequence(array, ...predicates)`
Assert each item passes its corresponding predicate:

```javascript
assertSequence(steps,
  s => s.phase === 'init',
  s => s.phase === 'process',
  s => s.phase === 'complete'
)
```

### Environment Configuration

Default values for `yamf test` live in **`.env.test`** (e.g. `packages/core/.env.test`). Prefer that and **`terminateAfter`** teardown instead of repeating the same vars in `withEnv`.

Use **`withEnv`** only when a test must **change** env (missing vars, feature flags, per-test secrets). See **`docs/TESTING.md`**.

```javascript
export async function testRequiresMissingRegistryUrl() {
  await withEnv({ YAMF_REGISTRY_URL: undefined /* ... */ }, async () => {
    // assert startup or request failure
  })
}
```

### Test File Organization

```
packages/core/tests/
├── cases/           # Unit tests for specific modules
│   ├── gateway-tests.js
│   ├── registry-tests.js
│   └── rate-limiter-tests.js
├── integration/     # End-to-end integration tests
│   └── rate-limiter-integration-tests.js
└── run-all-cases.js # Test runner entry point
```

## Architecture

**Spine and muscle memory:** the **registry** is the **spine** (authoritative state, pub/sub, convergence). Each peer keeps a **replicated in-process service cache** — **muscle memory** — so `callService` and similar paths resolve **locally** for steady work; the registry and cache path **re-teach** on deploy, register/unregister, or `REGISTRY_PULL` when needed. The **gateway** **pulls** the same state for external HTTP; it does not replace the registry as source of truth.

**Bird’s eye (anchor — no control-plane hop on hot paths):**

- **Service → register → Registry** (and **re-teach** with pub/sub, `REGISTRY_PULL`, or deploy).
- **Registry → (pub/sub cache line updates) → each process that holds a service cache.**
- **Service A → (HTTP, address from in-process cache) → Service B** (peer; hot path).
- **Client → gateway → service** (gateway’s routing is **pulled** from the registry, read-only, not a second authority).
- **Registry and gateway = siblings in roles** — not a vertical “gateway owns services” data-plane stack.
- **Heavy cache fan-out:** `YAMF_CACHE_COALESCE_MS` — [ROADMAP](docs/ROADMAP.md).
- The root [README](README.md) ASCII is optional garnish for human readers; this list is the signal for tools.

### Startup Sequence

1. **Registry starts** - listens for service registrations
2. **Gateway starts** - pulls initial state from registry, pre-registers itself
3. **Services start** - each service goes through two phases:
   - **Setup phase**: HTTP server starts (may retry on port conflicts)
   - **Register phase**: Service registers with registry (should not fail)
4. **Registry propagates state** - notifies gateway to re-pull after changes

### Service Lifecycle

```javascript
// Service creation with options
await createService('my-service', async function handler(payload) {
  return { result: payload.input * 2 }
}, {
  accessControl: 'public',  // 'pure' | 'local' | 'private' | 'public'
  // Other options: streamPayload, metadata, etc.
})
```

**Access Control Levels:**
- `pure`: No HTTP server, direct function call only (same process)
- `local`: HTTP server, accessible only from same node
- `private`: HTTP server, accessible from any service (default)
- `public`: HTTP server, accessible via gateway (external clients)

### Service Communication

Services can call each other through multiple mechanisms:

```javascript
// 1. Direct service call (uses internal cache for routing)
const result = await callService('other-service', payload)

// 2. Via registry (reverse proxy)
const result = await httpRequest(REGISTRY_URL, {
  headers: {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
    [HEADERS.SERVICE_NAME]: 'other-service'
  },
  body: payload
})

// 3. Via gateway (public entrypoint, same interface)
const result = await httpRequest(GATEWAY_URL, {
  headers: {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
    [HEADERS.SERVICE_NAME]: 'other-service'
  },
  body: payload
})

// 4. Via registered routes
const result = await httpRequest(`${GATEWAY_URL}/api/my-route`, {
  method: 'POST',
  body: payload
})
```

### State Synchronization

The registry is the **source of truth** for all state:
- Service locations
- Routes
- Access control rules
- Service metadata
- Rate limit configurations

When state changes:
1. Registry updates its internal state
2. Registry notifies gateway to re-pull
3. Gateway fetches complete state from registry
4. Gateway updates its local copy

**Important:** Gateway never pushes state to registry. It only pulls.

### Registration Headers

When services register, they send configuration via headers:

```javascript
{
  [HEADERS.COMMAND]: COMMANDS.SERVICE_REGISTER,
  [HEADERS.SERVICE_NAME]: 'my-service',
  [HEADERS.SERVICE_LOCATION]: 'http://localhost:10000',
  [HEADERS.ACCESS_CONTROL]: 'public',
  [HEADERS.REGISTRY_TOKEN]: 'secret-token',
  // Optional: rate limiting, auth requirements, etc.
}
```

## Code Style

### Imports

```javascript
// Test utilities
import { assert, assertErr, terminateAfter, withEnv, sleep } from '@yamf/test'

// Core framework
import {
  registryServer,
  gatewayServer,
  createService,
  createRoute,
  callService,
  httpRequest,
  HEADERS,
  COMMANDS,
  envConfig
} from '@yamf/core'  // or '../../src/index.js' for internal tests
```

### Naming Conventions

- Test functions: `testDescriptiveFeatureName` (exported, camelCase)
- Services: `kebab-case` for service names
- Files: `kebab-case.js`

### Error Handling

Expect errors using `assertErr`, not try/catch:

```javascript
// GOOD
await assertErr(
  async () => callService('nonexistent'),
  err => err.status === 404
)

// AVOID
try {
  await callService('nonexistent')
  assert(false) // "should have thrown"
} catch (err) {
  assert(err.status === 404)
}
```

## Common Patterns

### Creating Test Services

```javascript
await createService('test-service', async function(payload) {
  // `this` provides service context
  const otherResult = await this.call('other-service', payload)
  return { combined: otherResult }
}, { accessControl: 'public' })
```

### HTTP Routes

```javascript
await createRoute('/api/users', 'user-service')
await createRoute('/api/auth/*', 'auth-service')  // Wildcard routing
```

### Rate Limiting (Pre-bind API)

Rate limiting is configured via server options, not imperative function calls. This supports custom key functions (e.g., rate limit by username) since they stay on the server.

```javascript
// Registry with pre-bound rate limits (single options object; port from YAMF_REGISTRY_URL if omitted)
await registryServer({
  rateLimit: {
    default: { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 10000 },
    services: {
      'auth-service': { 
        windowMs: 60000, 
        maxRequestsPerIp: 10,
        customKeyFn: (payload) => payload?.username  // Rate limit by username
      }
    }
  }
})

// Gateway can have its own config (overrides registry default)
await gatewayServer(null, {
  rateLimit: {
    default: { windowMs: 60000, maxRequestsPerIp: 50, maxTotalRequests: 5000 },
    services: {
      'auth-service': { windowMs: 60000, maxRequestsPerIp: 5 }  // Stricter at gateway
    }
  }
})

// Service declares rate limit requirement (safety check at registration)
await createService('auth-service', handler, { 
  accessControl: 'public',
  rateLimit: true  // Error if no rate limit config exists
})
```

**Precedence:** Gateway service > Registry service > Gateway default > Registry default

## Testing Tips

1. **Use thunks** in `terminateAfter` (see above); do not pre-`await` server startups into the wrong order.
2. **Use `sleep()`** sparingly — only when waiting for async propagation.
3. **Rate limits are per-server instance** — each test creates fresh state.
4. **Use `envConfig.get()`** for environment-dependent URLs/values.
5. **Order matters** in `terminateAfter` — typically registry first, then services, then gateway when all three are used.

## File Locations

- **Core source:** `packages/core/src/`
- **API functions:** `packages/core/src/api/`
- **Registry:** `packages/core/src/registry/`
- **Gateway:** `packages/core/src/gateway/`
- **Rate limiter:** `packages/core/src/rate-limiter/`
- **Tests:** `packages/core/tests/`
- **Test library:** `packages/test/`
