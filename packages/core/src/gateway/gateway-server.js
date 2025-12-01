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

const logger = new Logger({ logGroup: 'yamf-gateway' })

/**
 * Create and start the gateway server
 */
export default async function createGatewayServer(port) {
  // TODO validate auth token exists for prod gateway (otherwise it will fail to update itself)
  const state = createGatewayState()
  
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
        response.writeHead(status, { 'content-type': 'text/plain' })
        response.end(err.stack || err.message)
      }
    }
  })
  
  // Override terminate to clean up state and handlers
  const httpServerTerminate = server.terminate.bind(server)
  server.terminate = async () => {
    logger.info('Gateway shutting down')
    
    // Remove global error handlers
    process.off('unhandledRejection', unhandledRejectionHandler)
    process.off('uncaughtException', uncaughtExceptionHandler)
    
    resetState(state)
    await httpServerTerminate()
  }
  
  server.isGateway = true
  
  // Do initial pull from registry if available
  const registryUrl = envConfig.get('YAMF_REGISTRY_URL')
  if (registryUrl) {
    const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
    try {
      const { buildRegistryPullHeaders } = await import('../shared/yamf-headers.js')
      const httpRequest = (await import('../http-primitives/http-request.js')).default
      
      logger.info('Gateway performing initial state pull from registry...')
      const registryState = await httpRequest(registryUrl, {
        headers: buildRegistryPullHeaders(registryToken)
      })
      
      // Import the update function from command-router
      const { updateGatewayStateFromRegistry } = await import('./command-router.js')
      updateGatewayStateFromRegistry(state, registryState)
      
      logger.info(`Gateway initialized with ${Object.keys(registryState.services || {}).length} services, ${Object.keys(registryState.routes || {}).length} routes`)
    } catch (err) {
      // Don't fail gateway startup if initial pull fails (registry might not be ready yet)
      logger.warn('Gateway initial pull failed (registry may not be ready):', err.message)
    }
  }
  
  return server
}
