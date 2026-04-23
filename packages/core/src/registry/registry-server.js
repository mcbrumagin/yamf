/**
 * Registry Server
 * Central service registry and router for @yamf/core
 * Refactored into modular components for better maintainability
 */

import createProxyServer from '../http-primitives/http-proxy-server.js'
import readStream from '../http-primitives/read-stream.js'
import Logger from '../utils/logger.js'
import envConfig from '../shared/env-config.js'
import { createRegistryState, resetState } from './registry-state.js'
import { routeCommand } from './command-router.js'
import { validateRegistryEnvironment } from './registry-auth.js'
import { preRegisterGatewayIfItExists, broadcastShutdown } from './service-registry.js'
import { performRegistryDrainHandshake, assignRegistryInstanceId } from './registry-drain-handshake.js'
import { notifyGatewayOfUpdate, drainCacheUpdateQueues } from './pubsub-manager.js'
import { registerCommand, unregisterCommand } from './command-router.js'
import { lifecycle } from '../shared/process-lifecycle.js'
import { setDefaultRateLimit, setServiceRateLimit } from '../rate-limiter/rate-limiter.js'
import { validateConfig } from '../rate-limiter/rate-limiter-config.js'

const logger = new Logger({ logGroup: 'yamf-registry' })

/**
 * Create and start the registry server
 * 
 * @param {number} [port] - Port to listen on (defaults to YAMF_REGISTRY_URL port)
 * @param {Object} [options] - Server options
 * @param {Object} [options.rateLimit] - Rate limit configuration
 * @param {Object} [options.rateLimit.default] - Default rate limit for all requests
 * @param {Object} [options.rateLimit.services] - Pre-bound service-specific rate limits
 * 
 * @example
 * await registryServer(8080, {
 *   rateLimit: {
 *     default: { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 10000 },
 *     services: {
 *       'auth-service': { 
 *         windowMs: 60000, 
 *         maxRequestsPerIp: 10,
 *         customKeyFn: (payload) => payload?.username 
 *       }
 *     }
 *   }
 * })
 */
export default async function createRegistryServer(port, options = {}) {
  const { broadcastShutdownOnTerminate = true } = options
  validateRegistryEnvironment()
  const state = createRegistryState()
  assignRegistryInstanceId(state)
  
  // Initialize rate limit configuration from options
  if (options.rateLimit) {
    const { default: defaultConfig, services: serviceConfigs } = options.rateLimit
    
    // Validate and store default config
    if (defaultConfig) {
      const validated = validateConfig(defaultConfig)
      state.rateLimitConfig.default = validated
      setDefaultRateLimit(state.rateLimiter, validated)
      logger.info('Registry rate limit default configured:', {
        windowMs: validated.windowMs,
        maxRequestsPerIp: validated.maxRequestsPerIp,
        maxTotalRequests: validated.maxTotalRequests
      })
    }
    
    // Validate and store service-specific configs
    if (serviceConfigs && typeof serviceConfigs === 'object') {
      for (const [serviceName, config] of Object.entries(serviceConfigs)) {
        const validated = validateConfig(config)
        // Preserve customKeyFn (not validated, but kept)
        if (config.customKeyFn) {
          validated.customKeyFn = config.customKeyFn
        }
        state.rateLimitConfig.services.set(serviceName, validated)
        setServiceRateLimit(state.rateLimiter, serviceName, validated)
        logger.info(`Registry rate limit for "${serviceName}" configured:`, {
          windowMs: validated.windowMs,
          maxRequestsPerIp: validated.maxRequestsPerIp,
          maxTotalRequests: validated.maxTotalRequests,
          hasCustomKeyFn: !!validated.customKeyFn
        })
      }
    }
  }
  
  // Add global unhandled rejection handler to prevent registry crashes
  // This is a safety net - errors should be caught at their source
  const unhandledRejectionHandler = (reason, promise) => {
    logger.error(logger.writeColor('magenta', 'Unhandled Promise Rejection in Registry (this should not happen): ', reason))
    // logger.error(logger.writeColor('magenta', 'Promise:'), promise)
    console.trace(promise) // TODO logger support
    // Don't crash the registry - log and continue
  }
  
  const uncaughtExceptionHandler = (err) => {
    logger.error('Uncaught Exception in Registry (this should not happen):', err)
    // Don't crash the registry - log and continue
  }
  
  process.on('unhandledRejection', unhandledRejectionHandler)
  process.on('uncaughtException', uncaughtExceptionHandler)
  
  // Determine port from argument or environment
  if (!port) {
    const registryHost = envConfig.getRequired('YAMF_REGISTRY_URL')
    if (registryHost) {
      port = registryHost.split(':')[2]
      if (!port || isNaN(port)) {
        throw new Error(
          'Please specify "port" arg or define "YAMF_REGISTRY_URL" env variable ' +
          'including protocol and port number'
        )
      }
    }
  }

  // Separately check for YAMF_GATEWAY_URL and pre-register it (for decoupling)
  preRegisterGatewayIfItExists(state)
  
  await performRegistryDrainHandshake(state)
  
  // Calculate default starting port for services
  const registryEndpoint = envConfig.getRequired('YAMF_REGISTRY_URL')
  const registryPort = registryEndpoint.split(':')[2]
  const defaultStartPort = registryPort && (Number(registryPort) + 1) || 10000
  
  // Create HTTP proxy server that doesn't parse request bodies by default
  // This allows streaming proxy for routes and service calls
  // Commands that need the body (like PUBSUB_PUBLISH) will parse it themselves
  const server = await createProxyServer(port, async function registryServer(request, response) {
    let payload = null
    try {
      // Determine if we need to parse the body
      // - PUBSUB_PUBLISH always needs body parsed
      // - SERVICE_CALL needs body parsed if target service has customKeyFn for rate limiting
      // TODO we should create a new deployable built-in service to offload customKeyFn processing for rate limits
      const command = request.headers['yamf-command']
      const serviceName = request.headers['yamf-service-name']
      
      let needsBodyParsing = command === 'pubsub-publish'
      
      // Check if SERVICE_CALL needs body parsing for custom key rate limiting
      if (command === 'service-call' && serviceName) {
        const serviceConfig = state.rateLimitConfig.services.get(serviceName)
        if (serviceConfig?.customKeyFn) {
          needsBodyParsing = true
        }
      }
      
      if (needsBodyParsing) {
        const bodyBuffer = await readStream(request)
        const contentType = request.headers['content-type'] || ''
        
        if (contentType.includes('application/json') && bodyBuffer.length > 0) {
          try {
            payload = JSON.parse(bodyBuffer.toString('utf8'))
          } catch (err) {
            payload = bodyBuffer
          }
        } else {
          payload = bodyBuffer
        }
        
        // Store the parsed body so it can be re-sent to the service
        // This is needed because we've consumed the stream
        request._parsedBody = payload
      }
      
      const result = await routeCommand(state, payload, request, response, {
        defaultStartPort,
        handlerFn: registryServer
      })
      
      // If routeCommand returned false, the response was already sent
      if (result === false) {
        return
      }
      
      // Send the result
      const contentType = typeof result === 'string' ? 'text/plain' : 'application/json'
      const body = typeof result === 'string' ? result : JSON.stringify(result)
      
      response.writeHead(200, { 'content-type': contentType })
      response.end(body)
      
    } catch (err) {
      if (!request || !request.headers['mute-internal-error']) {
        logger.debugErr('Registry command failed:', err)
      }
      const status = err.status || 500
      
      if (!response.writableEnded) {
        const extra = err.responseHeaders && typeof err.responseHeaders === 'object' ? err.responseHeaders : {}
        response.writeHead(status, { 'content-type': 'text/plain', ...extra })
        response.end(err.stack || err.message)
      }
    }
  })
  
  // Override terminate: broadcast shutdown, then state + socket
  const httpServerTerminate = server.terminate.bind(server)
  const runRegistryShutdown = async () => {
    logger.info('Registry shutting down')
    await drainCacheUpdateQueues(state)
    if (broadcastShutdownOnTerminate) {
      await broadcastShutdown(state, { reason: 'registry-shutdown' })
    }
    process.off('unhandledRejection', unhandledRejectionHandler)
    process.off('uncaughtException', uncaughtExceptionHandler)
    resetState(state)
    await httpServerTerminate()
  }
  const unregisterFromLifecycle = lifecycle.registerTerminable(runRegistryShutdown, { priority: 0 })
  server.terminate = async () => {
    unregisterFromLifecycle()
    await runRegistryShutdown()
  }
  
  server.isRegistry = true

  // Expose state for testing
  // Note: In production, access to state should be restricted
  server._state = state
  server.registerCommand = (name, handler, opts) => registerCommand(state, name, handler, opts)
  server.unregisterCommand = (name) => unregisterCommand(state, name)

  // After the server is listening, nudge a pre-existing gateway to re-pull state. This closes
  // the k3s rolling race where a gateway started before a fresh registry had empty state and
  // would otherwise wait for the first service registration to trigger a push.
  // Fire-and-forget: don't block registry readiness on gateway reachability.
  notifyGatewayOfUpdate(state, { service: 'yamf-registry', location: 'registry-ready' }).catch(() => {})

  return server
}
