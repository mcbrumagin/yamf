/**
 * Command Router
 * Routes incoming gateway commands to appropriate handlers
 * 
 * Supports both header-based and legacy payload-based routing
 */

import {
  findServiceLocation,
  streamProxyServiceCall
} from './service-registry.js'
import { findControllerRoute } from './route-registry.js'
import { resolvePossibleRoute } from './http-route-handler.js'
import { COMMANDS, parseCommandHeaders, isHeaderBasedCommand, buildRegistryPullHeaders } from '../shared/yamf-headers.js'
import HttpError from '../http-primitives/http-error.js'
import { validateRegistryToken } from './gateway-auth.js'
import httpRequest from '../http-primitives/http-request.js'
import envConfig from '../shared/env-config.js'

import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-gateway' })

/**
 * Commands that require registry token validation
 */
const PROTECTED_COMMANDS = new Set([
  COMMANDS.REGISTRY_UPDATED,
  COMMANDS.GATEWAY_PULL  // Dev/test only - pull gateway state
])

/**
 * Health check command
 */
function handleHealthCheck() {
  return { status: 'ready', timestamp: Date.now() }
}

/**
 * Handle gateway state pull (dev/test only)
 * Returns gateway's current state for testing purposes
 * SECURITY: Should be disabled in production
 */
function handleGatewayPull(state) {
  const env = envConfig.get('ENVIRONMENT', 'dev')
  
  // Block in production
  if (env.includes('prod') || env.includes('staging')) {
    throw new HttpError(403, 'Gateway state pull is disabled in production')
  }
  
  // Warn in development
  if (env.includes('dev')) {
    logger.warn('Gateway state pull requested - this should only be used for testing')
  }
  
  logger.debug('handleGatewayPull - returning gateway state for testing')
  
  return {
    services: Object.fromEntries(
      Array.from(state.services.entries()).map(([name, locations]) => [
        name, 
        Array.from(locations)
      ])
    ),
    routes: Object.fromEntries(state.routes),
    controllerRoutes: Object.fromEntries(state.controllerRoutes),
    serviceAuth: Object.fromEntries(state.serviceAuth),
    timestamp: Date.now()
  }
}

/**
 * Handle registry update notification
 * When notified that the registry has changed, pull full state from registry
 * This implements the pull-only security model for the gateway
 */
async function handleRegistryUpdated(state, payload, headers) {
  logger.info('Registry update notification received, pulling latest state...')
  
  const registryUrl = envConfig.getRequired('MICRO_REGISTRY_URL')
  const registryToken = envConfig.get('MICRO_REGISTRY_TOKEN')
  
  try {
    // Pull full registry state
    const registryState = await httpRequest(registryUrl, {
      headers: buildRegistryPullHeaders(registryToken)
    })
    
    // Update gateway state with pulled data
    updateGatewayStateFromRegistry(state, registryState)
    
    logger.info(`Gateway state updated from registry (${Object.keys(registryState.services || {}).length} services)`)
    
    return { 
      status: 'updated',
      servicesCount: Object.keys(registryState.services || {}).length,
      routesCount: Object.keys(registryState.routes || {}).length,
      timestamp: Date.now()
    }
  } catch (err) {
    logger.error('Failed to pull registry state:', err.message)
    throw new HttpError(503, `Failed to update from registry: ${err.message}`)
  }
}

/**
 * Update gateway state from registry pull
 * Converts plain objects back to Maps and Sets
 */
export function updateGatewayStateFromRegistry(state, registryState) {
  // Update services map (convert arrays back to Sets)
  state.services.clear()
  for (const [serviceName, locations] of Object.entries(registryState.services || {})) {
    state.services.set(serviceName, new Set(locations))
  }
  
  // Update routes
  state.routes.clear()
  for (const [path, routeInfo] of Object.entries(registryState.routes || {})) {
    state.routes.set(path, routeInfo)
  }
  
  // Update controller routes
  state.controllerRoutes.clear()
  for (const [path, routeInfo] of Object.entries(registryState.controllerRoutes || {})) {
    state.controllerRoutes.set(path, routeInfo)
  }
  
  // Update service auth mappings
  state.serviceAuth.clear()
  for (const [service, authService] of Object.entries(registryState.serviceAuth || {})) {
    state.serviceAuth.set(service, authService)
  }
  
  logger.debug('Gateway state synchronized with registry')
}

/**
 * Route incoming commands to their handlers
 * PRIORITY 1: Command headers (micro-command)
 * PRIORITY 2: HTTP routes (URL-based)
 */
export async function routeCommand(state, payload, request, response, options = {}) {
  const { defaultStartPort = 10000, handlerFn } = options
  const headers = request.headers || {}
  
  // PRIORITY 1: Command-based routing (for service operations, pubsub, etc.)
  const isHeaderCommand = isHeaderBasedCommand(headers)
  if (isHeaderCommand) {
    return routeCommandByHeaders(state, payload, request, response, options)
  }
  
  // PRIORITY 2: Check for HTTP routes (most specific - based on URL path)
  // Routes should work without any special headers
  if (request.url) { //&& request.url !== '/health' /* TODO VERIFY */) {
    const routeMatch = state.routes.get(request.url)
    const controllerMatch = !routeMatch && findControllerRoute(state, request.url)
    
    if (routeMatch || controllerMatch) {
      return resolvePossibleRoute(state, request, response, payload)
    }
  }
  
  throw new HttpError(404, 'Not found')
}

/**
 * Header-based command routing
 */
async function routeCommandByHeaders(state, payload, request, response) {
  const headers = request.headers || {}
  const { command } = parseCommandHeaders(headers)
  
  logger.debug('command:', command)

  if (PROTECTED_COMMANDS.has(command)) {
    validateRegistryToken(request)
  }
  
  switch (command) {
    case COMMANDS.HEALTH:
      return handleHealthCheck()
    
    case COMMANDS.GATEWAY_PULL:
      // Dev/test only: Return gateway state for testing
      return handleGatewayPull(state)
    
    case COMMANDS.REGISTRY_UPDATED:
      // Pull-only security model: Gateway receives lightweight notification,
      // then pulls full state from registry. This prevents compromised gateway
      // from being used to inject malicious service registrations.
      return handleRegistryUpdated(state, payload, headers)
    
    
    case COMMANDS.AUTH_LOGIN:
    case COMMANDS.AUTH_REFRESH:
      // Default to 'auth-service' if no specific auth service is configured
      const authServiceName = 'auth-service'
      if (!state.services.has(authServiceName)) {
        throw new HttpError(503, `Auth service "${authServiceName}" not found`)
      }
      
      // Proxy the auth request to the auth service
      return streamProxyServiceCall(state, { 
        name: authServiceName, 
        request, 
        response 
      })
    
    default:
      throw new HttpError(400, `Unknown command`)
  }
}
