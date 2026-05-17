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
import { HEADERS, COMMANDS, parseCommandHeaders, isHeaderBasedCommand, buildRegistryPullHeaders } from '../shared/yamf-headers.js'
import HttpError from '../http-primitives/http-error.js'
import { validateRegistryToken } from '../registry/registry-auth.js'
import httpRequest from '../http-primitives/http-request.js'
import envConfig from '../shared/env-config.js'

import Logger from '../utils/logger.js'
import { env } from 'node:process'

import { localState } from '../shared/local-state.js'
import readStream from '../http-primitives/read-stream.js'

// Rate limiter imports
import { 
  checkRateLimit, 
  setServiceRateLimit,
  setDefaultRateLimit
} from '../rate-limiter/rate-limiter.js'
import { deserializeConfig } from '../rate-limiter/rate-limiter-config.js'

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
  
  const registryUrl = envConfig.getRequired('YAMF_REGISTRY_URL')
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  
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
 * 
 * Rate limit precedence:
 * 1. Gateway service-specific config (highest priority)
 * 2. Registry service-specific config
 * 3. Gateway default config
 * 4. Registry default config (lowest priority)
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

  // Update service accessControl mappings
  state.serviceAccess.clear()
  for (const [service, accessControl] of Object.entries(registryState.serviceAccess || {})) {
    state.serviceAccess.set(service, accessControl)
  }
  
  // Update service types (e.g. 'sse')
  state.serviceTypes.clear()
  for (const [service, serviceType] of Object.entries(registryState.serviceTypes || {})) {
    state.serviceTypes.set(service, serviceType)
  }
  
  // Update per-service timeouts
  state.serviceTimeouts.clear()
  for (const [service, timeout] of Object.entries(registryState.serviceTimeouts || {})) {
    state.serviceTimeouts.set(service, timeout)
  }
  
  // Merge rate limit configurations from registry with gateway's own configs
  // Precedence: gateway service > registry service > gateway default > registry default
  const registryRateLimitConfig = registryState.rateLimitConfig || {}
  
  // Store registry service configs (for services gateway doesn't have its own config for)
  state.registryRateLimitServices.clear()
  for (const [service, serializedConfig] of Object.entries(registryRateLimitConfig.services || {})) {
    const config = deserializeConfig(serializedConfig)
    if (config) {
      state.registryRateLimitServices.set(service, config)
      
      // Only apply to rate limiter if gateway doesn't have its own config for this service
      if (state.rateLimiter && !state.rateLimitConfig.services.has(service)) {
        setServiceRateLimit(state.rateLimiter, service, config)
        logger.debug(`Applied registry rate limit for "${service}" to gateway`)
      }
    }
  }
  
  // Apply registry default only if gateway doesn't have its own config
  if (!state.gatewayOwnConfig && registryRateLimitConfig.default) {
    const defaultConfig = deserializeConfig(registryRateLimitConfig.default)
    if (defaultConfig && state.rateLimiter) {
      setDefaultRateLimit(state.rateLimiter, defaultConfig)
      logger.debug('Applied registry default rate limit to gateway')
    }
  }
  
  logger.debug('Gateway state synchronized with registry')
}

/**
 * Determine which service a request is targeting
 * Used for service-specific rate limiting
 */
function findTargetService(state, headers, url) {
  // Check for service name in headers (service call)
  const { serviceName } = parseCommandHeaders(headers)
  if (serviceName) return serviceName
  
  // Check if URL matches a route
  const routeMatch = state.routes.get(url)
  if (routeMatch?.service) return routeMatch.service
  
  // Check controller routes
  const controllerMatch = findControllerRoute(state, url)
  if (controllerMatch?.service) return controllerMatch.service
  
  return null
}

/**
 * Apply rate limit headers to response
 */
function applyRateLimitHeaders(response, headers) {
  for (const [header, value] of Object.entries(headers)) {
    response.setHeader(header, value)
  }
}

/**
 * Check if rate limiting should be applied to this command
 * Excludes internal infrastructure commands
 */
function shouldApplyRateLimit(headers) {
  const command = headers[HEADERS.COMMAND]
  
  // Don't rate limit internal infrastructure commands
  if (command === COMMANDS.REGISTRY_UPDATED) return false
  if (command === COMMANDS.GATEWAY_PULL) return false
  
  // Rate limit public-facing commands
  if (command === COMMANDS.SERVICE_CALL) return true
  if (command === COMMANDS.HEALTH) return true
  if (command === COMMANDS.AUTH_LOGIN) return true
  if (command === COMMANDS.AUTH_REFRESH) return true
  if (command === COMMANDS.AUTH_LOGOUT) return true
  
  // Rate limit URL-based routes (no command header)
  if (!command) return true
  
  return false
}

/**
 * Route incoming commands to their handlers
 * PRIORITY 0: Rate limit check (if enabled)
 * PRIORITY 1: Command headers (yamf-command)
 * PRIORITY 2: HTTP routes (URL-based)
 */
export async function routeCommand(state, payload, request, response, options = {}) {
  const { defaultStartPort = 10000, handlerFn } = options
  const headers = request.headers || {}
  
  // PRIORITY 0: Rate limit check (before any processing)
  // Only apply if rate limiting is configured and command should be rate limited
  const hasRateLimitConfig = state.gatewayOwnConfig || 
    state.rateLimitConfig.services.size > 0 || 
    state.registryRateLimitServices.size > 0
  
  if (state.rateLimiter && hasRateLimitConfig && shouldApplyRateLimit(headers)) {
    // Determine target service for service-specific rate limiting
    const targetService = findTargetService(state, headers, request.url)
    
    const rateLimitResult = checkRateLimit(state.rateLimiter, request, {
      serviceName: targetService,
      payload
    })
    
    // Always add rate limit headers to response
    applyRateLimitHeaders(response, rateLimitResult.headers)
    
    if (!rateLimitResult.allowed) {
      throw rateLimitResult.error // HttpError 429
    }
  }
  
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
 * Validate service access for gateway calls (external clients)
 * Gateway allows: public only
 * Gateway blocks: pure, local, private
 */
function validateServiceAccessFromGateway(state, serviceName) {
  const permission = state.serviceAccess.get(serviceName)
  
  // Default to 'private' if no access control is set (backwards compatibility)
  const effectivePermission = permission || 'private'
  
  if (effectivePermission !== 'public') {
    const env = envConfig.get('ENVIRONMENT', 'dev')
    if (env.includes('prod')) {
      // Don't reveal service name in production
      throw new HttpError(404, `Not found`)
    } else {
      const hint = effectivePermission === 'private' 
        ? `Change the service to use 'public' access control to allow gateway access.`
        : `Service has "${effectivePermission}" access control.`
      throw new HttpError(403, 
        `Service "${serviceName}" access forbidden from gateway. ${hint}`
      )
    }
  }
}

/**
 * Header-based command routing
 */
async function routeCommandByHeaders(state, payload, request, response) {
  const headers = request.headers || {}
  const { command, serviceName } = parseCommandHeaders(headers)
  
  logger.debug('command:', command)

  if (command === COMMANDS.REGISTRY_BROADCAST_SHUTDOWN) {
    validateRegistryToken(request)
    const registryUrl = envConfig.getRequired('YAMF_REGISTRY_URL')
    const reason = headers[HEADERS.SHUTDOWN_REASON] || 'yamf-stop'
    const regTok = process.env.YAMF_REGISTRY_TOKEN || envConfig.get('YAMF_REGISTRY_TOKEN', '')
    return await httpRequest(registryUrl, {
      headers: {
        [HEADERS.COMMAND]: COMMANDS.REGISTRY_BROADCAST_SHUTDOWN,
        [HEADERS.SHUTDOWN_REASON]: String(reason),
        ...(regTok && { [HEADERS.REGISTRY_TOKEN]: regTok })
      }
    })
  }

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
    case COMMANDS.AUTH_LOGOUT: {
      // Allow caller to target a non-default auth service via yamf-service-name, as long as
      // the gateway has cached it as serviceType === 'auth-service'. Otherwise fall back to
      // the conventional 'auth' service name.
      const DEFAULT_AUTH_SERVICE = 'auth'
      let authServiceName = DEFAULT_AUTH_SERVICE
      if (serviceName && serviceName !== DEFAULT_AUTH_SERVICE) {
        const requestedType = state.serviceTypes?.get(serviceName)
        if (requestedType === 'auth-service') authServiceName = serviceName
      }
      if (!state.services.has(authServiceName)) {
        throw new HttpError(503, `Auth service "${authServiceName}" not found`)
      }
      return streamProxyServiceCall(state, {
        name: authServiceName,
        request,
        response
      })
    }

    // for gateway service calls, we need to check that a service is published for public access
    // TODO provide config in createService to publish to gateways
    // publish should warn to use auth service for secure access
    // TODO test with/without auth service and with/without proper auth token
    case COMMANDS.SERVICE_CALL:
      logger.debug('service call:', serviceName)
      validateServiceAccessFromGateway(state, serviceName)
      
      return streamProxyServiceCall(state, {
        name: serviceName,
        request,
        response
      })
    
    default:
      throw new HttpError(400, `Unknown command`)
  }
}
