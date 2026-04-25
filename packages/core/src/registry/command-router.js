/**
 * Command Router
 * Routes incoming registry commands to appropriate handlers
 * 
 * Supports both header-based and legacy payload-based routing
 */

import { publish, subscribe, unsubscribe, notifyGatewayOfUpdate } from './pubsub-manager.js'
import { 
  allocateServicePort, 
  registerService, 
  unregisterService, 
  findServiceLocation,
  streamProxyServiceCall
} from './service-registry.js'
import { registerRoute, unregisterRoute, findControllerRoute } from './route-registry.js'
import { resolvePossibleRoute } from './http-route-handler.js'
import { HEADERS,COMMANDS, parseCommandHeaders, isHeaderBasedCommand } from '../shared/yamf-headers.js'
import HttpError from '../http-primitives/http-error.js'
import { validateRegistryToken, validateDeployToken } from './registry-auth.js'
import envConfig from '../shared/env-config.js'

import { localState } from '../shared/local-state.js'
import readStream from '../http-primitives/read-stream.js'

import Logger from '../utils/logger.js'
import { serializeReplicaMetadata } from './registry-state.js'

// Rate limiter imports
import { 
  checkRateLimit, 
  setServiceRateLimit 
} from '../rate-limiter/rate-limiter.js'
import { serializeConfig } from '../rate-limiter/rate-limiter-config.js'

const logger = new Logger({ logGroup: 'yamf-registry' })

function assertNotDrainingForNewRegistrations(state) {
  if (!state.draining) return
  const drainMs = Number(envConfig.get('YAMF_DRAIN_MS', 3000))
  const retryAfter = String(Math.ceil(drainMs / 1000) + 1)
  throw new HttpError(503, 'Registry is draining; retry registration', { 'Retry-After': retryAfter })
}

/**
 * Instruct this registry to reject new setup/register; used by a rolling replacement instance.
 * Response includes {@link HEADERS#REGISTRY_INSTANCE_ID} for the drained peer.
 */
async function handleRegistryDrainRequest(state, request, response) {
  const drainerId = request.headers[HEADERS.REGISTRY_INSTANCE_ID]
  if (!drainerId) {
    if (!response.writableEnded) {
      response.writeHead(400, { 'content-type': 'text/plain' })
      response.end('REGISTRY_DRAIN requires yamf-registry-instance-id')
    }
    return false
  }
  if (!state.registryInstanceId) {
    if (!response.writableEnded) {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end('REGISTRY instance id not assigned')
    }
    return false
  }
  if (drainerId === state.registryInstanceId) {
    if (!response.writableEnded) {
      response.writeHead(400, { 'content-type': 'text/plain' })
      response.end('Cannot drain: instance id matches this registry')
    }
    return false
  }
  state.draining = true
  logger.info(`Registry entering drain mode (drainer instance ${drainerId})`)
  if (!response.writableEnded) {
    const body = JSON.stringify({ draining: true, instanceId: state.registryInstanceId })
    response.writeHead(200, {
      'content-type': 'application/json',
      [HEADERS.REGISTRY_INSTANCE_ID]: state.registryInstanceId
    })
    response.end(body)
  }
  return false
}

/**
 * Commands that require registry token validation
 */
const PROTECTED_COMMANDS = new Set([
  COMMANDS.SERVICE_SETUP,
  COMMANDS.SERVICE_REGISTER,
  COMMANDS.SERVICE_UNREGISTER,
  COMMANDS.ROUTE_REGISTER,
  COMMANDS.ROUTE_UNREGISTER,
  COMMANDS.PUBSUB_PUBLISH,
  COMMANDS.PUBSUB_SUBSCRIBE,
  COMMANDS.PUBSUB_UNSUBSCRIBE,
  COMMANDS.REGISTRY_PULL  // Gateway pulls registry state
])

/**
 * Health check command
 */
function handleHealthCheck(state) {
  return { status: 'ready', timestamp: Date.now(), draining: !!state?.draining }
}

/**
 * Handle registry pull request from gateway
 * Returns full registry state for gateway to update its cache
 */
function handleRegistryPull(state) {
  logger.debug('handleRegistryPull - gateway requesting full registry state')
  
  // Serialize rate limit configs for transmission (from pre-bound configs)
  // Note: customKeyFn cannot be serialized - gateway must define its own if needed
  const serializedRateLimits = {}
  for (const [service, config] of state.rateLimitConfig.services.entries()) {
    serializedRateLimits[service] = serializeConfig(config)
  }
  
  // Also include default config if set
  const defaultRateLimit = state.rateLimitConfig.default 
    ? serializeConfig(state.rateLimitConfig.default)
    : null
  
  return {
    services: Object.fromEntries(
      Array.from(state.services.entries()).map(([name, locations]) => [
        name, 
        Array.from(locations)
      ])
    ),
    replicas: serializeReplicaMetadata(state),
    routes: Object.fromEntries(state.routes),
    controllerRoutes: Object.fromEntries(state.controllerRoutes),
    serviceAuth: Object.fromEntries(state.serviceAuth),
    serviceAccess: Object.fromEntries(state.serviceAccess),
    serviceMetadata: Object.fromEntries(state.serviceMetadata),
    rateLimitConfig: {
      default: defaultRateLimit,
      services: serializedRateLimits
    },
    serviceContracts: Object.fromEntries(state.serviceContracts),
    serviceTypes: Object.fromEntries(state.serviceTypes),
    serviceTimeouts: Object.fromEntries(state.serviceTimeouts),
    timestamp: Date.now()
  }
}

/**
 * Setup command - allocate port for new service
 */
function handleSetup(state, payload, headers, defaultStartPort) {
  assertNotDrainingForNewRegistrations(state)
  const { serviceName, serviceHome, rateLimitRequired } = parseCommandHeaders(headers)
  if (!serviceName) {
    throw new HttpError(400, 'SERVICE_SETUP requires yamf-service-name header')
  }
  if (!serviceHome) {
    throw new HttpError(400, 'SERVICE_SETUP requires yamf-service-home header')
  }
  if (rateLimitRequired === true) {
    const hasServiceConfig = state.rateLimitConfig.services.has(serviceName)
    const hasDefaultConfig = state.rateLimitConfig.default !== null
    
    if (!hasServiceConfig && !hasDefaultConfig) {
      throw new HttpError(400, 
        `Service "${serviceName}" requires rate limiting (rateLimit: true) but no rate limit is configured. ` +
        `Either configure a service-specific rate limit or a default rate limit on the registry.`
      )
    }
    
    logger.info(`Service "${serviceName}" rate limit requirement satisfied: ${hasServiceConfig ? 'service-specific' : 'default'}`)
  }
  return allocateServicePort(state, { 
    service: serviceName, 
    home: serviceHome 
  }, defaultStartPort)
}

/**
 * Register command - register service or route
 * Supports both header-based and legacy payload-based
 */
async function handleRegister(state, payload, headers = {}) {
  const {
    command, serviceName, serviceLocation,
    useAuthService, accessControl,
    routePath, routeDataType, routeType,
    rateLimitRequired, contract,
    serviceType, timeout,
    serviceMetadata
  } = parseCommandHeaders(headers)
  
  // Header-based registration
  if (command === COMMANDS.SERVICE_REGISTER) {
    assertNotDrainingForNewRegistrations(state)
    if (!serviceName) {
      throw new HttpError(400, 'SERVICE_REGISTER requires yamf-service-name header')
    }
    if (!serviceLocation) {
      throw new HttpError(400, 'SERVICE_REGISTER requires yamf-service-location header')
    }
    
    // TODO: Hybrid rate limiting - if service provides rateLimit config object
    // and registry has no pre-bind, store service's config as the service-specific limit
    
    return registerService(state, { 
      service: serviceName,
      location: serviceLocation,
      useAuthService: useAuthService,
      accessControl,
      contract,
      serviceType,
      timeout,
      metadata: serviceMetadata && typeof serviceMetadata === 'object' ? serviceMetadata : {}
    })
  } else if (command === COMMANDS.ROUTE_REGISTER) {
    if (!serviceName) {
      throw new HttpError(400, 'ROUTE_REGISTER requires yamf-service-name header')
    }
    if (!routePath) {
      throw new HttpError(400, 'ROUTE_REGISTER requires yamf-route-path header')
    }
    registerRoute(state, { 
      service: serviceName, 
      path: routePath, 
      dataType: routeDataType,
      type: routeType
    })
    
    // Notify gateway of route registration (pull model)
    await notifyGatewayOfUpdate(state, { 
      service: serviceName, 
      location: routePath 
    })
    
    return { success: true }
  }
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
 * Check headers to determine if a rate limit should be applied
 */
function shouldApplyRateLimit(headers) {
  let command = headers[HEADERS.COMMAND]
  if (command === COMMANDS.SERVICE_CALL
  || command === COMMANDS.PUBSUB_PUBLISH
  || command === COMMANDS.HEALTH
  || command === COMMANDS.REGISTRY_PULL) return true
  else return false
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
  
  // PRIORITY 0: Rate limit check for service calls (before any processing)
  // Only apply if rate limiting is configured (default or service-specific)
  const hasRateLimitConfig = state.rateLimitConfig.default !== null || state.rateLimitConfig.services.size > 0
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
  if (request.url) {
    const routeMatch = state.routes.get(request.url)
    const controllerMatch = !routeMatch && findControllerRoute(state, request.url)
    
    if (routeMatch || controllerMatch) {
      return resolvePossibleRoute(state, request, response, payload)
    }
  }
  
  throw new HttpError(404, 'Not found')
}

/**
 * Validate service access for registry-proxied calls
 * Registry allows: public, private (default)
 * Registry blocks: pure, local (these are node-local only)
 */
function validateServiceAccessFromRegistry(state, serviceName) {
  const permission = state.serviceAccess.get(serviceName)
  
  // Default to 'private' if no access control is set (backwards compatibility)
  const effectivePermission = permission || 'private'
  
  if (effectivePermission === 'pure' || effectivePermission === 'local') {
    const env = envConfig.get('ENVIRONMENT', 'dev')
    if (env.includes('prod')) {
      // Don't reveal service name in production
      throw new HttpError(404, `Not found`)
    } else {
      throw new HttpError(403, 
        `Service "${serviceName}" has "${effectivePermission}" access control and cannot be called through the registry. ` +
        `Pure/local services can only be called from the same node process.`
      )
    }
  }
  
  // public and private are allowed through registry
}

/**
 * Header-based command routing
 */
async function routeCommandByHeaders(state, payload, request, response, options) {
  const { defaultStartPort = 10000 } = options
  const headers = request.headers || {}
  const { command, serviceName, serviceLocation, serviceHome, pubsubChannel } = parseCommandHeaders(headers)
  
  logger.debug('command:', command)

  if (command === COMMANDS.REGISTRY_DRAIN) {
    validateRegistryToken(request)
    return await handleRegistryDrainRequest(state, request, response)
  }

  if (PROTECTED_COMMANDS.has(command)) {
    validateRegistryToken(request)
  }
  
  switch (command) {
    case COMMANDS.HEALTH:
      return handleHealthCheck(state)
    
    case COMMANDS.REGISTRY_PULL:
      return handleRegistryPull(state)
    
    case COMMANDS.SERVICE_SETUP:
      return handleSetup(state, payload, headers, defaultStartPort)
    
    case COMMANDS.SERVICE_REGISTER:
    case COMMANDS.ROUTE_REGISTER:
      return handleRegister(state, payload, headers)
    
    case COMMANDS.SERVICE_UNREGISTER:
      return await unregisterService(state, { 
        service: serviceName, 
        location: serviceLocation 
      })

    case COMMANDS.ROUTE_UNREGISTER:
      return unregisterRoute(state, {
        path: parseCommandHeaders(headers).routePath
      })
    
    case COMMANDS.SERVICE_LOOKUP:
      return findServiceLocation(state, serviceName)
    
    case COMMANDS.SERVICE_CALL:
      logger.debug('service call:', serviceName)

      validateServiceAccessFromRegistry(state, serviceName)
      
      return streamProxyServiceCall(state, { 
        name: serviceName, 
        request, 
        response 
      })
    
    case COMMANDS.PUBSUB_PUBLISH:
      if (!pubsubChannel) {
        throw new HttpError(400, 'PUBSUB_PUBLISH requires yamf-pubsub-channel header')
      }
      return publish(state, { 
        type: pubsubChannel, 
        message: payload 
      })
    
    case COMMANDS.PUBSUB_SUBSCRIBE:
      if (!pubsubChannel) {
        throw new HttpError(400, 'PUBSUB_SUBSCRIBE requires yamf-pubsub-channel header')
      }
      if (!serviceLocation) {
        throw new HttpError(400, 'PUBSUB_SUBSCRIBE requires yamf-service-location header')
      }
      return subscribe(state, { 
        type: pubsubChannel, 
        service: serviceName,
        location: serviceLocation 
      })
    
    case COMMANDS.PUBSUB_UNSUBSCRIBE:
      if (!pubsubChannel) {
        throw new HttpError(400, 'PUBSUB_UNSUBSCRIBE requires yamf-pubsub-channel header')
      }
      if (!serviceLocation) {
        throw new HttpError(400, 'PUBSUB_UNSUBSCRIBE requires yamf-service-location header')
      }
      return unsubscribe(state, { 
        type: pubsubChannel,
        service: serviceName,
        location: serviceLocation 
      })
    
    case COMMANDS.AUTH_LOGIN:
    case COMMANDS.AUTH_REFRESH:
    case COMMANDS.AUTH_LOGOUT: {
      // Allow caller to target a non-default auth service via yamf-service-name, as long as
      // that name is a known auth service (registered with serviceType === 'auth-service').
      // Absent a valid override, fall back to the conventional 'auth-service'.
      const DEFAULT_AUTH_SERVICE = 'auth-service'
      let authServiceName = DEFAULT_AUTH_SERVICE
      if (serviceName && serviceName !== DEFAULT_AUTH_SERVICE) {
        const requestedType = state.serviceTypes.get(serviceName)
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
    
    default: {
      const plugin = state.pluginCommands?.get(command)
      if (plugin) {
        if (plugin.requireDeployToken) {
          validateDeployToken(request)
        } else if (plugin.requireRegistryToken !== false) {
          validateRegistryToken(request)
        }
        const requesterLocation =
          request.headers?.[HEADERS.SERVICE_LOCATION] ||
          request.headers?.['x-forwarded-for'] ||
          null
        return await plugin.handler({ headers, body: payload, request, requesterLocation, response })
      }
      throw new HttpError(400, `Unknown command`)
    }
  }
}

const RESERVED_YAMF_COMMANDS = new Set(Object.values(COMMANDS))

/**
 * Register a custom `yamf-command` handler (slice F). Built-in COMMANDS values are reserved.
 * Cleared when the owning service+location unregisters (see service-registry).
 */
export function registerCommand(state, name, handler, { service, location, requireRegistryToken = true, requireDeployToken = false, parseJsonBody = true } = {}) {
  if (!name || typeof name !== 'string' || !handler) {
    throw new Error('registerCommand(name, handler, { service, location }): name and handler are required')
  }
  if (!service || !location) {
    throw new Error('registerCommand: service and location are required for lifecycle cleanup')
  }
  if (RESERVED_YAMF_COMMANDS.has(name)) {
    throw new HttpError(400, `Command "${name}" is reserved`)
  }
  if (!state.pluginCommands) {
    state.pluginCommands = new Map()
  }
  if (state.pluginCommands.has(name)) {
    throw new HttpError(409, `Command "${name}" is already registered`)
  }
  state.pluginCommands.set(name, { handler, service, location, requireRegistryToken, requireDeployToken, parseJsonBody })
  logger.debug('registerCommand', name, service, location)
}

export function unregisterCommand(state, name) {
  state.pluginCommands?.delete(name)
}
