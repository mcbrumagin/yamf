/**
 * Registry State Management
 * Manages all registry state including services, routes, and subscriptions
 */

import { createRateLimiterState, resetRateLimiterState } from '../rate-limiter/rate-limiter-state.js'

export function createRegistryState() {
  return {
    // Service name -> Set<location>
    services: new Map(),
    
    // Service name -> auth service name (for auth-protected services)
    serviceAuth: new Map(),
    
    // Service name -> access type
    // Access Control Levels:
    // - 'pure': No HTTP server, direct function call only (same node process)
    // - 'local': HTTP server but accessible only from same node
    // - 'private': HTTP server, accessible from any service (default)
    // - 'public': HTTP server, accessible via gateway (external clients)
    serviceAccess: new Map(),
    
    // Service name -> metadata object (for special services like gateway)
    serviceMetadata: new Map(),
    
    // Location -> service name (reverse lookup)
    addresses: new Map(),
    
    // Path -> { service, dataType }
    routes: new Map(),
    
    // Base path -> { service, dataType } (for wildcard routes)
    controllerRoutes: new Map(),
    
    // Domain -> next available port number
    domainPorts: new Map(),
    
    // Subscription type -> Set<location>
    subscriptions: new Map(),

    // Service name -> contract object (opt-in via useContract)
    serviceContracts: new Map(),
    
    // Service name -> service type ('sse', etc. -- absence means standard)
    serviceTypes: new Map(),
    
    // Service name -> timeout in ms (0 = no timeout, absence means default)
    serviceTimeouts: new Map(),
    
    // Pre-bound rate limit configuration (set at server startup)
    // Structure: { default: RateLimitConfig | null, services: Map<serviceName, RateLimitConfig> }
    rateLimitConfig: {
      default: null,
      services: new Map()
    },
    
    // Rate limiter runtime state (registry-local, not synced)
    rateLimiter: createRateLimiterState(),

    /** @type {string|null} set when this registry process starts */
    registryInstanceId: null,
    /** When true, new registrations are rejected (503) while calls/reads still work */
    draining: false,

    /** Monotonic id for coalesced cache-update windows (slice E) */
    cacheUpdateSeq: 0,

    /** @type {Map<string, { handler: Function, service: string, location: string }>} plugin yamf-command handlers (slice F) */
    pluginCommands: new Map(),

    /** @type {Map<string, number>} consecutive failed cache push windows per subscriber location */
    cachePushFailures: new Map(),

    /** @type {Set<string>} subscriber locations that stopped receiving cache pushes (slice E) */
    cacheUpdateStaleSubscribers: new Set(),

    /**
     * Per-subscriber coalesce buffers (slice E)
     * @type {Map<string, { items: Array<{ subscription: string, service: string, location: string, contract: * }>, firstAt: number | null, debounceTimer: ReturnType<typeof setTimeout> | null, maxTimer: ReturnType<typeof setTimeout> | null }>}
     */
    cacheCoalesceBySubscriber: new Map(),

    /**
     * Per replica instance (Phase 2) — key `${service}\0${location}` → { sourceHash?, configVersion?, registeredAt }
     * @type {Map<string, { sourceHash?: string, configVersion?: string, registeredAt: number }>}
     */
    replicaMetadata: new Map()
  }
}

/**
 * Reset all state to initial values
 */
export function resetState(state) {
  state.services.clear()
  state.serviceAuth.clear()
  state.serviceMetadata.clear()
  state.addresses.clear()
  state.routes.clear()
  state.controllerRoutes.clear()
  state.domainPorts.clear()
  state.subscriptions.clear()
  state.serviceContracts.clear()
  state.serviceTypes.clear()
  state.serviceTimeouts.clear()
  state.cacheUpdateSeq = 0
  state.pluginCommands?.clear()
  state.cachePushFailures?.clear()
  state.cacheUpdateStaleSubscribers?.clear()
  if (state.cacheCoalesceBySubscriber) {
    for (const p of state.cacheCoalesceBySubscriber.values()) {
      if (p.debounceTimer) clearTimeout(p.debounceTimer)
      if (p.maxTimer) clearTimeout(p.maxTimer)
    }
    state.cacheCoalesceBySubscriber.clear()
  }
  state.replicaMetadata?.clear()

  // Note: rateLimitConfig is NOT reset - it's configuration set at startup
  // Only reset the runtime rate limiter state
  if (state.rateLimiter) {
    resetRateLimiterState(state.rateLimiter)
  }
  state.draining = false
  // registryInstanceId kept for debugging until next server boot
}

/**
 * Convert Set to Array (replaces global Set.prototype.map pollution)
 */
export function setToArray(set, mapFn = item => item) {
  return Array.from(set, mapFn)
}

/**
 * Serialize services Map to plain object for API responses
 */
export function serializeServicesMap(servicesMap) {
  const result = {}
  for (const [serviceName, locations] of servicesMap) {
    result[serviceName] = setToArray(locations)
  }
  return result
}

/**
 * Build `replicas` object for REGISTRY_PULL (per-instance source hash / config version).
 * @param {ReturnType<typeof createRegistryState>} state
 * @returns {Record<string, Array<{ location: string, sourceHash?: string, configVersion?: string, registeredAt: number }>>}
 */
export function serializeReplicaMetadata(state) {
  const out = {}
  if (!state.replicaMetadata) return out
  for (const [key, v] of state.replicaMetadata) {
    const nul = key.indexOf('\0')
    if (nul === -1) continue
    const service = key.slice(0, nul)
    const location = key.slice(nul + 1)
    if (!out[service]) out[service] = []
    out[service].push({ location, ...v })
  }
  return out
}

