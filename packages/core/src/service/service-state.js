import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-service' })

/**
 * Service State Management
 * Manages local service cache of registry state
 * 
 * Uses Map/Set for consistency with registry/gateway state
 */


/**
 * Create a new service cache state
 * Mirrors registry state structure for consistency
 */
export function createServiceState() {
  return {
    // service name -> Set<location>
    services: new Map(),

    // service name -> access type ('pure', 'local', 'private', 'public', 'external')
    serviceAccess: new Map(),
    
    // location -> service name (reverse lookup)
    addresses: new Map(),

    // subscription type -> Set<location>
    subscriptions: new Map(),

    // service name -> contract object (opt-in via useContract)
    serviceContracts: new Map()
  }
}

/**
 * Convert Set to Array for serialization
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
 * Serialize Map to plain object
 */
export function serializeMap(map) {
  return Object.fromEntries(map)
}

/**
 * Update cache with data from registry
 * Converts plain objects back to Maps/Sets
 */
export function updateCache(cache, registryData) {
  if (registryData.addresses) {
    cache.addresses.clear()
    for (const [loc, name] of Object.entries(registryData.addresses)) {
      cache.addresses.set(loc, name)
    }
  }
  
  if (registryData.services) {
    cache.services.clear()
    for (const [name, locations] of Object.entries(registryData.services)) {
      cache.services.set(name, new Set(Array.isArray(locations) ? locations : [locations]))
    }
  }
  
  if (registryData.serviceAccess) {
    for (const [name, access] of Object.entries(registryData.serviceAccess)) {
      cache.serviceAccess.set(name, access)
    }
  }
  
  if (registryData.subscriptions) {
    cache.subscriptions.clear()
    for (const [type, locations] of Object.entries(registryData.subscriptions)) {
      cache.subscriptions.set(type, new Set(Array.isArray(locations) ? locations : [locations]))
    }
  }

  if (registryData.serviceContracts) {
    cache.serviceContracts.clear()
    for (const [name, contract] of Object.entries(registryData.serviceContracts)) {
      cache.serviceContracts.set(name, contract)
    }
  }
}

/**
 * Update cache with a single service/location pair
 * Used when registry broadcasts service additions
 */
export function updateCacheEntry(cache, { subscription, service, accessControl, location, contract }) {
  logger.debug('updateCacheEntry', { subscription, service, accessControl, location })
  
  // New service in registry: subscription omitted/legacy (null/undefined) or literal string "undefined"
  if ((subscription == null || subscription === 'undefined') && service && service !== 'undefined') {
    cache.addresses.set(location, service)
    
    if (!cache.services.has(service)) {
      cache.services.set(service, new Set())
    }
    
    // Add location to service set
    cache.services.get(service).add(location)
    
    // Handle access control for external pure/local services
    // If a pure/local service exists on another node, mark it as 'external' here
    if ((accessControl === 'pure' || accessControl === 'local') && !cache.serviceAccess.has(service)) {
      cache.serviceAccess.set(service, 'external')
      logger.debug(`Marked service "${service}" as external (${accessControl} on another node)`)
    } else if (accessControl && accessControl !== 'pure' && accessControl !== 'local') {
      // For private/public services, store the actual access control
      cache.serviceAccess.set(service, accessControl)
    }

    if (contract) {
      cache.serviceContracts.set(service, contract)
    }
  } 
  // Handle subscription updates
  else if (subscription && subscription !== 'undefined') {
    if (!cache.subscriptions.has(subscription)) {
      cache.subscriptions.set(subscription, new Set())
    }
    
    cache.subscriptions.get(subscription).add(location)
  }
}

/**
 * Remove service from cache
 */
export function removeFromCache(cache, { service, location }) {
  // Remove from addresses
  cache.addresses.delete(location)
  
  // Remove from services
  const serviceLocations = cache.services.get(service)
  if (serviceLocations) {
    serviceLocations.delete(location)
    
    // Remove service entry if no locations remain
    if (serviceLocations.size === 0) {
      cache.services.delete(service)
      cache.serviceAccess.delete(service)
      cache.serviceContracts.delete(service)
    }
  }
}

/**
 * Clear all cache data
 */
export function clearCache(cache) {
  cache.services.clear()
  cache.serviceAccess.clear()
  cache.addresses.clear()
  cache.subscriptions.clear()
  cache.serviceContracts.clear()
}

/**
 * Check if a service exists in cache
 */
export function hasService(cache, serviceName) {
  return cache.services.has(serviceName)
}

/**
 * Get service locations from cache
 */
export function getServiceLocations(cache, serviceName) {
  const locations = cache.services.get(serviceName)
  return locations ? setToArray(locations) : []
}

/**
 * Get service access control level
 */
export function getServiceAccess(cache, serviceName) {
  return cache.serviceAccess.get(serviceName)
}
