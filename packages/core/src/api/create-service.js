/**
 * Create Service
 * Main service creation and registration module
 * Refactored into modular components for better maintainability
 * 
 * Access Control Levels:
 * - 'pure': No HTTP server, direct function call only (same node process)
 * - 'local': HTTP server but accessible only from same node
 * - 'private': HTTP server, accessible from any service (default)
 * - 'public': HTTP server, accessible via gateway (external clients)
 */

import Logger from '../utils/logger.js'
import envConfig from '../shared/env-config.js'

import { createServiceState, updateCache, removeFromCache } from '../service/service-state.js'
import { buildEnhancedContext, bindServiceFunction } from '../service/service-context.js'
import { createCacheAwareHandler } from '../service/cache-handler.js'
import { validateServiceName } from '../service/service-validator.js'
import { createServiceBatch } from '../service/service-batch.js'
import { buildContract } from '../service/service-contract.js'
import { Next } from '../http-primitives/next.js'
import {
  createAndRegisterService,
  unregisterServiceFromRegistry,
  notifyRegistryOfPureService
} from './service-helpers.js'

import { 
  registerLocalService, 
  unregisterLocalService, 
  hasLocalService,
  getLocalServiceAccess
} from '../shared/local-state.js'

import crypto from 'crypto'

const logger = new Logger({ logGroup: 'yamf-api' })

/**
 * Configuration for service setup
 */
const DEFAULT_CONFIG = {
  tryRegisterLimit: envConfig.get('YAMF_RETRY_LIMIT', 3),
  retryInitialDelay: envConfig.get('YAMF_RETRY_DELAY', 20),
  muteRetryWarnings: envConfig.get('YAMF_MUTE_RETRY_WARNINGS', false),
  sharedCache: null, // Optional pre-created cache for batch operations
  streamPayload: false, // If true, don't buffer request body - pass raw stream to handler
  accessControl: 'private', // 'pure', 'local', 'private', 'public'
  useContract: true
}

/**
 * Create and start a microservice
 * 
 * @param {string|Function} name - Service name or named function
 * @param {Function} [serviceFn] - Service handler function
 * @param {Object} [options] - Service configuration options
 * @param {string} [options.accessControl='private'] - Access control level:
 *   - 'pure': No HTTP server, direct function call only (same node)
 *   - 'local': HTTP server, accessible only from same node
 *   - 'private': HTTP server, accessible from any service (default)
 *   - 'public': HTTP server, accessible via gateway (external clients)
 * @param {boolean} [options.rateLimit] - If true, require rate limit config exists on registry/gateway
 * @returns {Promise<Object>} HTTP server instance with service metadata (or minimal object for 'pure')
 * 
 * @example
 * // With separate name and function
 * const server = await createService('userService', async function(payload) {
 *   return { user: 'data' }
 * })
 * 
 * @example
 * // With named function
 * const server = await createService(async function userService(payload) {
 *   return { user: 'data' }
 * })
 * 
 * @example
 * // Pure local function (no HTTP server)
 * const service = await createService('helperService', async function(payload) {
 *   return { computed: payload.x * 2 }
 * }, { accessControl: 'pure' })
 * 
 * @example
 * // Service requiring rate limit (safety check)
 * const service = await createService('auth-service', async function(payload) {
 *   return { authenticated: true }
 * }, { accessControl: 'public', rateLimit: true })
 */
export default async function createService(name, serviceFn, options = {}) {
  if (
    !(typeof name === 'string' && name && typeof serviceFn === 'function') &&
    !(typeof name === 'function')
  ) {
    throw new Error(
      'Please provide a function, or a service name and its function separately'
    )
  }

  if (typeof name === 'function') {
    options = options && Object.keys(options).length === 0 ? serviceFn : options
    serviceFn = name
    name = serviceFn.name || `Anon$${crypto.randomBytes(4).toString('hex')}`
    if (name.includes('Anon$')) logger.debug('createService - generated name:', name)
  }

  validateServiceName(name)

  const config = { ...DEFAULT_CONFIG, ...options }
  config.useAuthService = config.useAuthService?.name || config.useAuthService

  const contract = buildContract(config.useContract, serviceFn)
  if (contract) config.contract = contract
  
  const cache = config.sharedCache || createServiceState()

  // Build context without location initially (no subscriptions in regular services)
  const context = buildEnhancedContext(cache, name)
  const boundServiceFn = bindServiceFunction(serviceFn, context)

  // Handle pure services (no HTTP server)
  if (config.accessControl === 'pure') {
    return createPureService(name, boundServiceFn, cache, context, config)
  }

  // For non-pure services, check for local service name collision
  if (hasLocalService(name)) {
    const existingAccess = getLocalServiceAccess(name)
    throw new Error(
      `Cannot create service "${name}" with accessControl="${config.accessControl}". ` +
      `A ${existingAccess} service with this name already exists on this process.\n` +
      `Options:\n`
      + `  - Rename one of the services if they contain different functionality\n`
      + `  - For load-balancing: run the second service on a different process or node\n`
      // TODO this message doesn't make sense if the existing service is private
      // + `  - Change the existing service to use 'private' or 'public' access control\n`
      // TODO also doesn't make sense? idk
      // + `  - Use a plain function instead of a service if load-balancing isn't needed`
    )
  }

  // Register in local state for direct calls (with HTTP server)
  registerLocalService(name, boundServiceFn, config.accessControl)

  const handler = createCacheAwareHandler(boundServiceFn, cache, context)

  // override handler name
  Object.defineProperty(handler, 'name', { value: name, writable: false })

  // Setup service infrastructure using shared helpers
  let result
  try {
    result = await createAndRegisterService(name, handler, config)
  } catch (err) {
    // Clean up local registration on failure
    unregisterLocalService(name)
    
    if (err.message.includes('listen EADDRINUSE')) {
      // Retry on port collision
      return createService(name, serviceFn, options)
    } else {
      throw err
    }
  }

  const { location, server, registryData } = result
  
  updateCache(cache, registryData)

  logger.info(`Service "${name}" running at ${location}`)
  
  // Add metadata
  server.name = name
  server.service = name
  server.location = location
  server.cache = cache
  server.context = context
  server.accessControl = config.accessControl

  let originalHandler = server.handler
  let pubSubManager = null
  let subscriptionIds = {}

  let pubsubHandler = null
  let overrideHandler = null

  // TODO: Remove this deprecated method and related code (pubSubManager, subscriptionIds, pubsubHandler variables above)
  // Use createSubscriptionService instead for pub/sub functionality
  /**
   * @deprecated Use createSubscriptionService instead.
   * Dynamic subscriptions on regular services are being removed in favor of
   * the cleaner separation: createService for RPC, createSubscriptionService for pub/sub.
   */
  server.createSubscription = async function createSubscriptionForService(channelOrMap, handler) {
    throw new Error(
      'DEPRECATED: server.createSubscription() is deprecated. ' +
      'Use createSubscriptionService() instead for pub/sub functionality. ' +
      'This method will be removed in a future version.'
    )
  }

  /**
   * Add a preprocessing function that runs before the main service handler
   * 
   * This is a SINGLE override function (not full middleware chain support).
   * The function receives the payload and can transform it before passing to the main handler.
   * 
   * Note: Only ONE override can be set. Calling this multiple times will replace the previous override.
   * 
   * @param {Function} overrideFn - Function that processes payload before main handler
   *                                 Should return transformed payload or Next/response control
   * 
   * @example
   * const service = await createService('user-service', async function(payload) {
   *   return { user: payload.userId, processed: payload.timestamp }
   * })
   * 
   * service.before(async (payload, request, response) => {
   *   // Add timestamp to all requests
   *   payload.timestamp = Date.now()
   *   return payload  // Transformed payload passed to main handler
   * })
   * 
   * @example
   * // Early return without calling main handler
   * service.before(async (payload, request, response) => {
   *   if (!payload.authenticated) {
   *     response.writeHead(401)
   *     response.end(JSON.stringify({ error: 'Unauthorized' }))
   *     return new Next()  // Skip main handler
   *   }
   *   return payload
   * })
   */
  server.before = function (overrideFn) {
    overrideHandler = async function preprocess(payload, request, response) {
      logger.debug('calling before override', payload)
      let processedPayload = await overrideFn(payload, request, response)
      if (processedPayload instanceof Next || response.isEnded) {
        return processedPayload
      } else {
        logger.debug('calling original handler', processedPayload)
        return await originalHandler(processedPayload, request, response)
      }
    }
    if (!pubsubHandler) {
      server.handler = overrideHandler
    } // else, we already have a reference setup
  }

  // override terminate to gracefully unregister
  const httpServerTerminate = server.terminate.bind(server)
  server.terminate = async () => {
    unregisterLocalService(name)
    removeFromCache(cache, { service: name, location })
    await unregisterServiceFromRegistry(name, location)
    await httpServerTerminate()
  }

  return server
}

/**
 * Create a pure service (no HTTP server)
 * Pure services are only accessible via direct function calls from the same node process
 * 
 * @param {string} name - Service name
 * @param {Function} boundServiceFn - Service function bound to context
 * @param {Object} cache - Service cache
 * @param {Object} context - Service context
 * @param {Object} config - Service configuration
 * @returns {Promise<Object>} Minimal service object with expected interface
 */
async function createPureService(name, boundServiceFn, cache, context, config) {
  // Check for existing local service
  if (hasLocalService(name)) {
    const existingAccess = getLocalServiceAccess(name)
    throw new Error(
      `Cannot create pure service "${name}". ` +
      `A ${existingAccess} service with this name already exists on this node.`
    )
  }

  // Register in local state
  registerLocalService(name, boundServiceFn, 'pure')
  
  // Notify registry for observability (registry tracks pure services for awareness)
  try {
    const registryData = await notifyRegistryOfPureService(name, config)
    if (registryData) {
      updateCache(cache, registryData)
    }
  } catch (err) {
    // Don't fail if registry notification fails - pure services work locally
    logger.warn(`Failed to notify registry of pure service "${name}":`, err.message)
  }

  logger.info(`Pure service "${name}" registered (no HTTP server)`)

  let overrideHandler = null
  let originalFn = boundServiceFn

  // Create a wrapper function that supports .before()
  const wrappedFn = async function pureServiceWrapper(payload) {
    if (overrideHandler) {
      return await overrideHandler(payload)
    }
    return await originalFn(payload)
  }

  // Return minimal service object with expected interface
  const pureService = {
    name,
    service: name,
    location: null, // No location for pure services
    cache,
    context,
    accessControl: 'pure',
    
    // Direct function call
    call: wrappedFn,
    
    // Handler for compatibility
    handler: wrappedFn,

    /**
     * Add a preprocessing function that runs before the main service handler
     * For pure services, this works without request/response objects
     */
    before: function (overrideFn) {
      overrideHandler = async function preprocess(payload) {
        logger.debug('calling before override (pure service)', payload)
        let processedPayload = await overrideFn(payload, null, null)
        if (processedPayload === undefined || processedPayload instanceof Next) {
          return processedPayload
        }
        logger.debug('calling original handler (pure service)', processedPayload)
        return await originalFn(processedPayload)
      }
    },

    /**
     * Terminate the pure service
     */
    terminate: async () => {
      unregisterLocalService(name)
      removeFromCache(cache, { service: name, location: null })
      logger.info(`Pure service "${name}" terminated`)
    }
  }

  return pureService
}

/**
 * Create multiple services concurrently
 * Optimized to share cache state among all services for better performance
 * 
 * Benefits:
 * - All services share the same cache, updated when any service registers
 * - Validates all services upfront before creating any
 * - More efficient than individual createService calls
 * 
 * @param {...Function} fns - Named service functions
 * @returns {Promise<Array<Object>>} Array of server instances
 * 
 * @example
 * const [server1, server2] = await createServices(
 *   async function userService(payload) { ... },
 *   async function authService(payload) { ... }
 * )
 */
export function createServices(...fns) {
  fns.unshift(fns.pop()) // rearrange for spread
  let [options, ...serviceFns] = fns
  if (typeof options === 'function') {
    serviceFns.push(options) // just another service
    options = {}
  }

  return createServiceBatch(serviceFns, createService, options)
}
