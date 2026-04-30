/**
 * Gateway Server
 * Central service gateway and router for @yamf/core
 * Refactored into modular components for better maintainability
 */

import createProxyServer from '../http-primitives/http-proxy-server.js'
import readStream from '../http-primitives/read-stream.js'
import Logger from '../utils/logger.js'
import envConfig from '../shared/env-config.js'
import { createGatewayState, resetState } from './gateway-state.js'
import { routeCommand } from './command-router.js'
import { setDefaultRateLimit, setServiceRateLimit } from '../rate-limiter/rate-limiter.js'
import { validateConfig } from '../rate-limiter/rate-limiter-config.js'
import { lifecycle } from '../shared/process-lifecycle.js'

const logger = new Logger({ logGroup: 'yamf-gateway' })

/**
 * Create and start the gateway server
 * 
 * @param {number} [port] - Port to listen on (defaults to YAMF_GATEWAY_URL port)
 * @param {Object} [options] - Server options
 * @param {Object} [options.rateLimit] - Rate limit configuration
 * @param {Object} [options.rateLimit.default] - Default rate limit for all requests
 * @param {Object} [options.rateLimit.services] - Pre-bound service-specific rate limits
 * 
 * @example
 * await gatewayServer(8080, {
 *   rateLimit: {
 *     default: { windowMs: 60000, maxRequestsPerIp: 50, maxTotalRequests: 5000 },
 *     services: {
 *       'auth-service': { 
 *         windowMs: 60000, 
 *         maxRequestsPerIp: 5,  // Stricter at public gateway
 *         customKeyFn: (payload) => payload?.username 
 *       }
 *     }
 *   }
 * })
 */
export default async function createGatewayServer(port, options = {}) {
  // TODO validate auth token exists for prod gateway (otherwise it will fail to update itself)
  const state = createGatewayState()
  
  // Initialize rate limit configuration from options
  if (options.rateLimit) {
    state.gatewayOwnConfig = true  // Flag that gateway has its own config
    const { default: defaultConfig, services: serviceConfigs } = options.rateLimit
    
    // Validate and store default config
    if (defaultConfig) {
      const validated = validateConfig(defaultConfig)
      state.rateLimitConfig.default = validated
      setDefaultRateLimit(state.rateLimiter, validated)
      logger.info('Gateway rate limit default configured:', {
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
        logger.info(`Gateway rate limit for "${serviceName}" configured:`, {
          windowMs: validated.windowMs,
          maxRequestsPerIp: validated.maxRequestsPerIp,
          maxTotalRequests: validated.maxTotalRequests,
          hasCustomKeyFn: !!validated.customKeyFn
        })
      }
    }
  }
  
  // Add global unhandled rejection handler to prevent gateway crashes
  // This is a safety net - errors should be caught at their source
  const unhandledRejectionHandler = (reason, promise) => {
    logger.error(logger.writeColor('magenta', 'Unhandled Promise Rejection in Gateway (this should not happen): ', reason))
    // logger.error(logger.writeColor('magenta', 'Promise:'), promise)
    console.trace(promise) // TODO logger support
    // Don't crash the gateway - log and continue
  }
  
  const uncaughtExceptionHandler = (err) => {
    logger.error('Uncaught Exception in Gateway (this should not happen):', err)
    // Don't crash the gateway - log and continue
  }
  
  process.on('unhandledRejection', unhandledRejectionHandler)
  process.on('uncaughtException', uncaughtExceptionHandler)
  
  // Determine port from argument or environment
  if (!port) {
    const gatewayHost = process.env.YAMF_GATEWAY_URL
    if (gatewayHost) {
      port = gatewayHost.split(':')[2]
      if (!port || isNaN(port)) {
        throw new Error(
          'Please specify "port" arg or define "YAMF_GATEWAY_URL" env variable ' +
          'including protocol and port number'
        )
      }
    }
  }
  
  // Calculate default starting port for services
  const gatewayEndpoint = envConfig.getRequired('YAMF_GATEWAY_URL')
  const gatewayPort = gatewayEndpoint.split(':')[2]
  const defaultStartPort = gatewayPort && (Number(gatewayPort) + 1) || 10000
  
  // Create HTTP proxy server that doesn't parse request bodies by default
  // This allows streaming proxy for routes and service calls
  // Commands that need the body (like PUBSUB_PUBLISH) will parse it themselves
  const server = await createProxyServer(port, async function gatewayServer(request, response) {
    let payload = null
    try {
      // Parse body only for commands that need it (PUBSUB_PUBLISH)
      // For proxy operations (SERVICE_CALL, routes, auth), leave the stream untouched
      const command = request.headers['yamf-command']
      const needsBodyParsing = command === 'pubsub-publish'
      
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
      }
      
      const result = await routeCommand(state, payload, request, response, {
        defaultStartPort,
        handlerFn: gatewayServer
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
        logger.debugErr('Gateway command failed:', err)
      }
      const status = err.status || 500
      
      if (!response.writableEnded) {
        const extra = err.responseHeaders && typeof err.responseHeaders === 'object' ? err.responseHeaders : {}
        response.writeHead(status, { 'content-type': 'text/plain', ...extra })
        response.end(err.stack || err.message)
      }
    }
  })
  
  // Override terminate to clean up state and handlers
  const httpServerTerminate = server.terminate.bind(server)
  const runGatewayShutdown = async () => {
    logger.info('Gateway shutting down')
    process.off('unhandledRejection', unhandledRejectionHandler)
    process.off('uncaughtException', uncaughtExceptionHandler)
    resetState(state)
    await httpServerTerminate()
  }
  // Late-bound: lifecycle invokes whatever `server.terminate` resolves to at
  // shutdown time so wrappers that override `server.terminate` are honored.
  let unregisterFromLifecycle
  server.terminate = async () => {
    unregisterFromLifecycle?.()
    await runGatewayShutdown()
  }
  unregisterFromLifecycle = lifecycle.registerTerminable(
    () => server.terminate(),
    { priority: 0 }
  )
  
  server.isGateway = true
  
  // Expose state for testing
  // Note: In production, access to state should be restricted
  server._state = state
  
  // Initial pull from registry — waits for a non-draining registry before pulling state.
  // During a rolling k3s deploy, DNS may briefly still resolve to an old registry that is
  // in drain. Pulling from a draining registry gives us stale / partial state, so we prefer
  // to wait for a ready peer. We do not block gateway startup indefinitely; if the registry
  // never becomes ready, REGISTRY_UPDATED push notifications will still reconcile us.
  const registryUrl = envConfig.get('YAMF_REGISTRY_URL')
  if (registryUrl) {
    const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
    const { buildRegistryPullHeaders } = await import('../shared/yamf-headers.js')
    const httpRequest = (await import('../http-primitives/http-request.js')).default
    const { updateGatewayStateFromRegistry } = await import('./command-router.js')

    const readyWaitMs = Number(envConfig.get('YAMF_GATEWAY_READY_WAIT_MS', 10000))
    const pollIntervalMs = Number(envConfig.get('YAMF_GATEWAY_READY_POLL_MS', 250))
    const deadline = Date.now() + readyWaitMs

    async function registryIsReady() {
      try {
        const health = await httpRequest(registryUrl, {
          headers: { 'yamf-command': 'health' }
        })
        return !!health && health.draining !== true
      } catch {
        return false
      }
    }

    logger.info('Gateway waiting for ready (non-draining) registry...')
    let ready = await registryIsReady()
    while (!ready && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollIntervalMs))
      ready = await registryIsReady()
    }

    if (!ready) {
      logger.warn(`Gateway: no ready registry after ${readyWaitMs}ms; will rely on REGISTRY_UPDATED push notifications to populate state.`)
    } else {
      try {
        logger.info('Gateway performing initial state pull from registry...')
        const registryState = await httpRequest(registryUrl, {
          headers: buildRegistryPullHeaders(registryToken)
        })
        updateGatewayStateFromRegistry(state, registryState)
        logger.info(`Gateway initialized with ${Object.keys(registryState.services || {}).length} services, ${Object.keys(registryState.routes || {}).length} routes`)
      } catch (err) {
        logger.warn('Gateway initial pull failed:', err.message)
      }
    }
  }

  return server
}
