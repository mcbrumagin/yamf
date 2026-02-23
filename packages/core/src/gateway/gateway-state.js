/**
 * Gateway State Management
 * Manages all gateway state including services, routes, and subscriptions
 */

import { createRateLimiterState, resetRateLimiterState } from '../rate-limiter/rate-limiter-state.js'

export function createGatewayState() {
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

    // Location -> service name (reverse lookup)
    addresses: new Map(),
    
    // Path -> { service, dataType }
    routes: new Map(),
    
    // Base path -> { service, dataType } (for wildcard routes)
    controllerRoutes: new Map(),
    
    // Service name -> service type ('sse', etc.)
    serviceTypes: new Map(),
    
    // Service name -> timeout in ms (0 = no timeout)
    serviceTimeouts: new Map(),
    
    // Subscription type -> Set<location>
    subscriptions: new Map(),
    
    // Pre-bound rate limit configuration (set at server startup)
    // Structure: { default: RateLimitConfig | null, services: Map<serviceName, RateLimitConfig> }
    rateLimitConfig: {
      default: null,
      services: new Map()
    },
    
    // Flag indicating gateway has its own rate limit config (don't override with registry default)
    gatewayOwnConfig: false,
    
    // Service rate limits synced from registry (merged with gateway's own)
    // This is populated during registry pull
    registryRateLimitServices: new Map(),
    
    // Rate limiter runtime state (gateway-local, not synced)
    rateLimiter: createRateLimiterState()
  }
}

/**
 * Reset all state to initial values
 */
export function resetState(state) {
  state.services.clear()
  state.serviceAuth.clear()
  state.serviceTypes.clear()
  state.serviceTimeouts.clear()
  state.addresses.clear()
  state.routes.clear()
  state.controllerRoutes.clear()
  state.subscriptions.clear()
  state.registryRateLimitServices.clear()
  
  // Note: rateLimitConfig and gatewayOwnConfig are NOT reset - they're configuration set at startup
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

