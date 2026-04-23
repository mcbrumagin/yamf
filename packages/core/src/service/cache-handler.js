/**
 * Cache Handler
 * Handles cache update messages from registry and delegates to service function
 */

import { updateCacheEntry } from './service-state.js'
import { updateContext } from './service-context.js'
import { Next } from '../http-primitives/next.js'
import { HEADERS, COMMANDS, parseCommandHeaders } from '../shared/yamf-headers.js'
import envConfig from '../shared/env-config.js'
import Logger from '../utils/logger.js'
import readStream from '../http-primitives/read-stream.js'
import { validateRegistryToken as validateRegistryTokenOrThrow403 } from '../registry/registry-auth.js'
import HttpError from '../http-primitives/http-error.js'

const logger = new Logger({ logGroup: 'yamf-api' })

/**
 * Check if request is a cache update from registry
 * Uses yamf headers to identify internal cache update calls
 * 
 * @param {Object} request - HTTP request object with headers
 * @returns {boolean} True if this is a cache update request
 */
export function isCacheUpdateRequest(request) {
  if (!request || !request.headers) {
    return false
  }
  
  const { command } = parseCommandHeaders(request.headers)
  return command === COMMANDS.CACHE_UPDATE
}

/**
 * Registry-issued graceful shutdown to this service
 */
export function isServiceShutdownRequest(request) {
  if (!request?.headers) return false
  const { command } = parseCommandHeaders(request.headers)
  return command === COMMANDS.SERVICE_SHUTDOWN
}

/**
 * Check if request is a subscription message from registry
 * Uses yamf headers to identify pubsub subscription messages
 * 
 * @param {Object} request - HTTP request object with headers
 * @returns {boolean} True if this is a subscription message
 */
export function isSubscriptionMessage(request) {
  if (!request || !request.headers) {
    return false
  }
  
  const { command } = parseCommandHeaders(request.headers)
  return command === COMMANDS.PUBSUB_PUBLISH
}

function validateCacheMessageRegistryToken(request) {
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  if (!registryToken) {
    return true
  }
  const authHeader = request?.headers?.[HEADERS.REGISTRY_TOKEN]
  if (authHeader !== registryToken) {
    throw new Error('Unauthorized cache update attempt')
  }
}

/**
 * Create a handler function that intercepts cache updates
 * Returns a new handler that:
 * 1. Checks if payload is a cache update
 * 2. If yes, updates cache and returns success
 * 3. If no, delegates to actual service function
 * 
 * The handler forwards request and response objects to the service function,
 * allowing services to directly control HTTP responses (streaming, custom headers, etc.)
 * 
 * @param {Function} serviceFn - The actual service handler function
 * @param {Object} cache - Service cache object
 * @param {Object} context - Service execution context
 * @param {Object} [serviceOptions]
 * @param {{ terminate: () => void | Promise<void> } | { terminate: null }} [serviceOptions.shutdownTerminateRef] — set `.terminate` to `server.terminate` after the server is created
 * @returns {Function} Wrapped handler
 */
export function createCacheAwareHandler(serviceFn, cache, context, serviceOptions = {}) {
  return async function cacheAwareHandler(payload, request, response) {
    if (isServiceShutdownRequest(request)) {
      const ref = serviceOptions.shutdownTerminateRef
      try {
        validateRegistryTokenOrThrow403(request)
      } catch (err) {
        const e = new HttpError(401, 'Invalid or missing registry token for service shutdown')
        e.stack = err.stack
        throw e
      }
      if (typeof ref?.terminate !== 'function') {
        throw new HttpError(500, 'Service shutdown not available')
      }
      response.writeHead(202)
      response.end()
      queueMicrotask(() => {
        Promise.resolve()
          .then(() => ref.terminate())
          .catch((err) => { logger.debugErr('service-shutdown terminate:', err) })
      })
      return false
    }

    // Check if this is a cache update from registry using yamf headers
    if (isCacheUpdateRequest(request)) {
      validateCacheMessageRegistryToken(request)
      const { pubsubChannel, serviceName, accessControl, serviceLocation, contract } = parseCommandHeaders(request.headers)
      
      logger.debug('cacheAwareHandler - cache update request', { pubsubChannel, serviceName, serviceLocation })

      // Update local cache
      updateCacheEntry(cache, {
        subscription: pubsubChannel,
        service: serviceName,
        accessControl: accessControl,
        location: serviceLocation,
        contract
      })
      
      // Update context to reflect new services
      updateContext(context, cache)
      
      // Return success response
      return {
        status: 'cache_updated',
        subscription: pubsubChannel,
        service: serviceName,
        location: serviceLocation
      }
    }
    
    if (isSubscriptionMessage(request)) {
      validateCacheMessageRegistryToken(request)
      const { pubsubChannel } = parseCommandHeaders(request.headers)

      if (context._pubSubManager) {
        const subscriptions = context._pubSubManager.listSubscriptions()
        if (subscriptions[pubsubChannel]) {
          // If the server is in stream mode (payload === null) and we have a JSON
          // content-type, drain the body so we can dispatch the parsed message.
          if (payload == null && request.headers['content-type'] === 'application/json') {
            const raw = await readStream(request)
            try { payload = JSON.parse(raw) } catch { payload = raw }
          }
          return await context._pubSubManager.handleIncomingMessage(pubsubChannel, payload)
        }
      }

      return await serviceFn(payload, request, response)
    }
    
    // Not a cache update or subscription - delegate to actual service function with request/response
    const result = await serviceFn(payload, request, response)
    
    // If service returned Next instance, convert to false for http-server
    // This signals that the service has handled the response directly
    if (result instanceof Next) {
      return false
    }
    
    return result
  }
}
