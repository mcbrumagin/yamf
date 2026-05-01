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
import envConfig, { envTruthy } from '../shared/env-config.js'

import { createServiceState, updateCache, removeFromCache } from '../service/service-state.js'
import { buildEnhancedContext, updateContext, bindServiceFunction } from '../service/service-context.js'
import { createCacheAwareHandler } from '../service/cache-handler.js'
import { lifecycle } from '../shared/process-lifecycle.js'
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

const logger = new Logger({ logGroup: 'yamf-api' })

function isExtractServiceContract () {
  return envTruthy(envConfig.get('YAMF_EXTRACT_SERVICE_CONTRACT', false))
}

const DEFAULT_CONFIG = {
  tryRegisterLimit: envConfig.get('YAMF_RETRY_LIMIT', 3),
  retryInitialDelay: envConfig.get('YAMF_RETRY_DELAY_MS', envConfig.get('YAMF_RETRY_DELAY', 100)),
  muteRetryWarnings: envConfig.get('YAMF_MUTE_RETRY_WARNINGS', false),
  /** Optional pre-created cache for batch operations. */
  sharedCache: null,
  /** If true, don't buffer request body — pass raw stream to handler. */
  streamPayload: false,
  /** `'pure'` | `'local'` | `'private'` | `'public'` */
  accessControl: 'private',
  useContract: true
}

/**
 * Create and start a microservice.
 *
 * Access control levels:
 * - `'pure'`    — no HTTP server, direct function call only (same node process)
 * - `'local'`   — HTTP server but accessible only from the same node
 * - `'private'` — HTTP server, accessible from any service (default)
 * - `'public'`  — HTTP server, accessible via gateway (external clients)
 *
 * @param {string} serviceName - Service name (kebab-case recommended; required and explicit).
 * @param {Function} serviceFn - Async service handler `(payload, request, response) => result`.
 * @param {Object} [options]
 * @param {'pure'|'local'|'private'|'public'} [options.accessControl='private']
 * @param {boolean} [options.rateLimit] - Require rate-limit config to exist on registry/gateway.
 * @param {Object} [options.metadata]   - Extra metadata published with the service registration.
 * @param {Object} [options.sharedCache] - Pre-created cache (used by {@link createServices}).
 * @param {boolean} [options.useContract=true] - Auto-extract a contract from `serviceFn`.
 * @returns {Promise<Object>} HTTP server instance with service metadata (or a minimal object for `'pure'`).
 *
 * @example
 * const service = await createService('user', async function (payload) {
 *   return { user: 'data' }
 * })
 *
 * @example
 * // Pure local service (no HTTP server)
 * const service = await createService('helper', async function (payload) {
 *   return { computed: payload.x * 2 }
 * }, { accessControl: 'pure' })
 */
export default async function createService (serviceName, serviceFn, options = {}) {
  if (typeof serviceName === 'function') {
    throw new TypeError(
      'createService: pass an explicit service name as the first argument. ' +
      "Replace `createService(fn)` with `createService('my-service', fn)`."
    )
  }
  if (typeof serviceName !== 'string' || !serviceName || typeof serviceFn !== 'function') {
    throw new TypeError(
      'createService(serviceName, serviceFn[, options]): the service name must be a non-empty string and the service function must be a function.'
    )
  }

  validateServiceName(serviceName)

  const config = { ...DEFAULT_CONFIG, ...options }
  config.metadata = { cacheBulk: true, ...(config.metadata || {}) }
  config.useAuthService = config.useAuthService?.name || config.useAuthService

  const contract = buildContract(config.useContract, serviceFn)
  if (contract) config.contract = contract

  if (isExtractServiceContract()) {
    return { yamfContractExtract: true, name: serviceName, contract: contract || null }
  }

  const cache = config.sharedCache || createServiceState()
  const context = buildEnhancedContext(cache, serviceName)
  const boundServiceFn = bindServiceFunction(serviceFn, context)

  if (config.accessControl === 'pure') {
    return createPureService(serviceName, boundServiceFn, cache, context, config)
  }

  if (hasLocalService(serviceName)) {
    const existingAccess = getLocalServiceAccess(serviceName)
    throw new Error(
      `Cannot create service "${serviceName}" with accessControl="${config.accessControl}". ` +
      `A ${existingAccess} service with this name already exists on this process.\n` +
      'Options:\n' +
      '  - Rename one of the services if they contain different functionality\n' +
      '  - For load-balancing: run the second service on a different process or node'
    )
  }

  registerLocalService(serviceName, boundServiceFn, config.accessControl)

  const shutdownTerminateRef = { terminate: null }
  const handler = createCacheAwareHandler(boundServiceFn, cache, context, { shutdownTerminateRef })
  Object.defineProperty(handler, 'name', { value: serviceName, writable: false })

  let result
  try {
    result = await createAndRegisterService(serviceName, handler, config)
  } catch (err) {
    unregisterLocalService(serviceName)
    if (err.message.includes('listen EADDRINUSE')) {
      // Port collision — retry once with the same args (registry will allocate a new port).
      return createService(serviceName, serviceFn, options)
    }
    throw err
  }

  const { location, server, registryData } = result

  updateCache(cache, registryData)
  updateContext(context, cache)

  logger.info(`Service "${serviceName}" running at ${location}`)

  server.name = serviceName
  server.service = serviceName
  server.location = location
  server.cache = cache
  server.context = context
  server.accessControl = config.accessControl

  let originalHandler = server.handler
  let overrideHandler = null

  /**
   * Add a single preprocessing function that runs before the main service handler.
   * Calling `before` again replaces the previous override (this is not a middleware chain).
   *
   * The override receives `(payload, request, response)` and may:
   * - return a transformed payload (passed to the main handler), or
   * - return a {@link Next} instance / end the response, to skip the main handler.
   */
  server.before = function (overrideFn) {
    overrideHandler = async function preprocess (payload, request, response) {
      logger.debug('calling before override', payload)
      const processedPayload = await overrideFn(payload, request, response)
      if (processedPayload instanceof Next || response.isEnded) {
        return processedPayload
      }
      logger.debug('calling original handler', processedPayload)
      return await originalHandler(processedPayload, request, response)
    }
    server.handler = overrideHandler
  }

  const httpServerTerminate = server.terminate.bind(server)
  const runServiceShutdown = async () => {
    unregisterLocalService(serviceName)
    await httpServerTerminate()
    removeFromCache(cache, { service: serviceName, location })
    try {
      await unregisterServiceFromRegistry(serviceName, location)
    } catch (err) {
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET' && err.code !== 'ENOTFOUND') {
        throw err
      }
    }
  }
  // Late-bound: lifecycle invokes whatever `server.terminate` resolves to at
  // shutdown time, so wrappers that override `server.terminate` to add cleanup
  // (e.g. `clearInterval` in @yamf/services-cache) are honored on SIGTERM/SIGINT,
  // not only on explicit `server.terminate()` calls.
  let unregisterFromLifecycle
  server.terminate = async () => {
    unregisterFromLifecycle?.()
    await runServiceShutdown()
  }
  unregisterFromLifecycle = lifecycle.registerTerminable(
    () => server.terminate(),
    { priority: 10 }
  )
  shutdownTerminateRef.terminate = () => server.terminate()

  return server
}

/**
 * Create a pure service (no HTTP server). Only callable in-process from the same node.
 */
async function createPureService (serviceName, boundServiceFn, cache, context, config) {
  if (hasLocalService(serviceName)) {
    const existingAccess = getLocalServiceAccess(serviceName)
    throw new Error(
      `Cannot create pure service "${serviceName}". ` +
      `A ${existingAccess} service with this name already exists on this node.`
    )
  }

  registerLocalService(serviceName, boundServiceFn, 'pure')

  // Notify registry for observability — pure services still work locally if this fails.
  // notifyRegistryOfPureService never throws; returns null when no registry URL is set.
  const registryData = await notifyRegistryOfPureService(serviceName, config)
  if (registryData) {
    updateCache(cache, registryData)
    updateContext(context, cache)
  }

  logger.info(`Pure service "${serviceName}" registered (no HTTP server)`)

  let overrideHandler = null
  const originalFn = boundServiceFn

  const wrappedFn = async function pureServiceWrapper (payload) {
    if (overrideHandler) return await overrideHandler(payload)
    return await originalFn(payload)
  }

  return {
    name: serviceName,
    service: serviceName,
    location: null,
    cache,
    context,
    accessControl: 'pure',

    call: wrappedFn,
    handler: wrappedFn,

    before (overrideFn) {
      overrideHandler = async function preprocess (payload) {
        logger.debug('calling before override (pure service)', payload)
        const processedPayload = await overrideFn(payload, null, null)
        if (processedPayload instanceof Next) {
          return processedPayload
        }
        logger.debug('calling original handler (pure service)', processedPayload)
        return await originalFn(processedPayload)
      }
    },

    async terminate () {
      unregisterLocalService(serviceName)
      removeFromCache(cache, { service: serviceName, location: null })
      logger.info(`Pure service "${serviceName}" terminated`)
    }
  }
}

/**
 * Create multiple services concurrently with a shared cache.
 *
 * All arguments must be **named** functions (the function name becomes the service name).
 * An optional final argument is a shared options object applied to every service. Validates
 * all functions upfront before creating any (no half-started batches).
 *
 * For an explicit name + handler shape, call {@link createService} directly per service.
 *
 * @param {...Function} fns - Named service functions, optionally followed by an options object.
 * @returns {Promise<Array<Object>>} Array of server instances.
 *
 * @example
 * const [users, auth] = await createServices(
 *   async function userService (payload) { return { …  } },
 *   async function authService (payload) { return { …  } }
 * )
 */
export function createServices (...fns) {
  let options = {}
  if (fns.length > 0 && typeof fns[fns.length - 1] !== 'function') {
    options = fns.pop() || {}
  }
  return createServiceBatch(fns, createService, options)
}
