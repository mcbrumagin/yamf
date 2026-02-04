/**
 * Local State
 * Used for direct local calls that bypass the network
 * if any sister services are created on the same node thread
 * 
 * Uses Map for consistency with registry/gateway/service state
 */

/**
 * Local state singleton
 * Contains services and subscriptions running in the current node process
 */
export const localState = {
  // serviceName -> { fn: boundServiceFn, accessControl: 'pure'|'local' }
  services: new Map(),
  
  // channel -> Set<handler function>
  subscriptions: new Map()
}

/**
 * Register a local service
 * @param {string} name - Service name
 * @param {Function} fn - Bound service function
 * @param {string} accessControl - 'pure' or 'local'
 */
export function registerLocalService(name, fn, accessControl = 'pure') {
  localState.services.set(name, { fn, accessControl })
}

/**
 * Unregister a local service
 * @param {string} name - Service name
 */
export function unregisterLocalService(name) {
  localState.services.delete(name)
}

/**
 * Get a local service function
 * @param {string} name - Service name
 * @returns {Function|null} Service function or null if not found
 */
export function getLocalService(name) {
  const entry = localState.services.get(name)
  return entry ? entry.fn : null
}

/**
 * Check if a local service exists
 * @param {string} name - Service name
 * @returns {boolean}
 */
export function hasLocalService(name) {
  return localState.services.has(name)
}

/**
 * Get local service access control level
 * @param {string} name - Service name
 * @returns {string|null} Access control level or null if not found
 */
export function getLocalServiceAccess(name) {
  const entry = localState.services.get(name)
  return entry ? entry.accessControl : null
}

/**
 * Register a local subscription handler
 * @param {string} channel - Subscription channel
 * @param {Function} handler - Handler function
 */
export function registerLocalSubscription(channel, handler) {
  if (!localState.subscriptions.has(channel)) {
    localState.subscriptions.set(channel, new Set())
  }
  localState.subscriptions.get(channel).add(handler)
}

/**
 * Unregister a local subscription handler
 * @param {string} channel - Subscription channel
 * @param {Function} handler - Handler function
 */
export function unregisterLocalSubscription(channel, handler) {
  const handlers = localState.subscriptions.get(channel)
  if (handlers) {
    handlers.delete(handler)
    if (handlers.size === 0) {
      localState.subscriptions.delete(channel)
    }
  }
}

/**
 * Get all local subscription handlers for a channel
 * @param {string} channel - Subscription channel
 * @returns {Set<Function>} Set of handler functions
 */
export function getLocalSubscriptionHandlers(channel) {
  return localState.subscriptions.get(channel) || new Set()
}

/**
 * Clear all local state (useful for testing)
 */
export function clearLocalState() {
  localState.services.clear()
  localState.subscriptions.clear()
}
