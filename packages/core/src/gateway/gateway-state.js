/**
 * Registry State Management
 * Manages all registry state including services, routes, and subscriptions
 */

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
    
    // Subscription type -> Set<location>
    subscriptions: new Map()
  }
}

/**
 * Reset all state to initial values
 */
export function resetState(state) {
  state.services.clear()
  state.serviceAuth.clear()
  state.addresses.clear()
  state.routes.clear()
  state.controllerRoutes.clear()
  state.subscriptions.clear()
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

