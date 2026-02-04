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
    
    // Pre-bound rate limit configuration (set at server startup)
    // Structure: { default: RateLimitConfig | null, services: Map<serviceName, RateLimitConfig> }
    rateLimitConfig: {
      default: null,
      services: new Map()
    },
    
    // Rate limiter runtime state (registry-local, not synced)
    rateLimiter: createRateLimiterState()
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
  
  // Note: rateLimitConfig is NOT reset - it's configuration set at startup
  // Only reset the runtime rate limiter state
  if (state.rateLimiter) {
    resetRateLimiterState(state.rateLimiter)
  }
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

