/**
 * Yamf Headers
 * Constants and utilities for header-based command routing.
 * Covers core protocol (SERVICE_CALL, REGISTER, UNREGISTER, lookup), pub/sub,
 * rate limiting, contracts, and the rolling-registry drain/shutdown handoff.
 */

/**
 * Header name constants
 */
export const HEADERS = {
  // Command routing
  COMMAND: 'yamf-command',
  
  // Service operations
  SERVICE_NAME: 'yamf-service-name',
  /** When set, registry SERVICE_CALL may route to this pm3-service instance (must be a registered location for the service) */
  SERVICE_PREFER_LOCATION: 'yamf-prefer-service-location',
  SERVICE_LOCATION: 'yamf-service-location',
  USE_AUTH_SERVICE: 'yamf-use-auth-service',
  SERVICE_HOME: 'yamf-service-home',
  ACCESS_CONTROL: 'yamf-access-control',     // 'public', 'custom', or 'private'
  
  // Authentication // TODO Authorization: Bearer <token>
  AUTH_TOKEN: 'yamf-auth-token',           // User auth token for service calls
  REGISTRY_TOKEN: 'yamf-registry-token',   // Internal registry/service token
  /** Separate blast radius for deploy plan/bundle (slice C3) */
  DEPLOY_TOKEN: 'yamf-deploy-token',
  /** Content hash for streamed bundle (sha256-…) */
  DEPLOY_HASH: 'yamf-deploy-hash',
  /** Opaque deploy actor (e.g. user@host) */
  DEPLOYER: 'yamf-deployer',
  
  // TODO VERIFY
  // Route operations (for registration only - routes use request.url for routing)
  ROUTE_DATATYPE: 'yamf-route-datatype',
  ROUTE_TYPE: 'yamf-route-type',  // 'route' or 'controller'
  ROUTE_PATH: 'yamf-route-path',  // Only used during route registration
  
  // Pub/sub operations
  PUBSUB_CHANNEL: 'yamf-pubsub-channel',
  
  // Rate limiting
  RATE_LIMIT_REQUIRED: 'yamf-rate-limit-required', // 'true' if service requires rate limit config

  // Service contracts
  SERVICE_CONTRACT: 'yamf-service-contract', // JSON-serialized contract object

  // Service type and timeout (for SSE, future WebSocket, etc.)
  SERVICE_TYPE: 'yamf-service-type',   // 'standard', 'sse', etc.
  TIMEOUT: 'yamf-timeout',            // Per-service timeout in ms (0 = no timeout)

  // Rolling registry
  REGISTRY_INSTANCE_ID: 'yamf-registry-instance-id',
  SHUTDOWN_REASON: 'yamf-shutdown-reason',

  /** JSON object: e.g. `{ "cacheBulk": true }` */
  SERVICE_METADATA: 'yamf-service-metadata',

  /** Bulk cache update window (registry → subscriber) */
  CACHE_BULK: 'yamf-cache-bulk',
  CACHE_WINDOW_ID: 'yamf-cache-window-id'
}

/**
 * Well-known global pub/sub channel: `yamf dev` publishes here after a successful local/remote
 * deploy; {@link @yamf/services-dev-hmr} subscribes and fans out SSE `reload` (ROADMAP Phase 4 D2).
 */
export const PUBSUB_CHANNEL_YAMF_DEV_RELOAD = 'yamf:dev-reload'

/**
 * Command types (values for yamf-command header)
 */
export const COMMANDS = {
  // Shared
  HEALTH: 'health',

  // Registry
  SERVICE_SETUP: 'service-setup',
  SERVICE_REGISTER: 'service-register',
  SERVICE_UNREGISTER: 'service-unregister',
  SERVICE_LOOKUP: 'service-lookup',
  SERVICE_CALL: 'service-call',
  ROUTE_REGISTER: 'route-register',
  ROUTE_UNREGISTER: 'route-unregister',
  PUBSUB_PUBLISH: 'pubsub-publish',
  PUBSUB_SUBSCRIBE: 'pubsub-subscribe',
  PUBSUB_UNSUBSCRIBE: 'pubsub-unsubscribe',
  
  // Gateway
  REGISTRY_UPDATED: 'registry-updated',  // Notification to gateway that registry changed
  REGISTRY_PULL: 'registry-pull',        // Gateway pulls full registry state
  GATEWAY_PULL: 'gateway-pull',          // Pull gateway state (dev/test only)

  // Authentication
  AUTH_LOGIN: 'auth-login',
  AUTH_REFRESH: 'auth-refresh',
  AUTH_LOGOUT: 'auth-logout',

  // Service
  CACHE_UPDATE: 'cache-update',
  SERVICE_SHUTDOWN: 'service-shutdown',

  // Registry rolling handoff
  REGISTRY_DRAIN: 'registry-drain',

  // Server-rendered / signed handler round-trip (SSR invoke)
  SSR_INVOKE_HANDLER: 'ssr-invoke-handler'
}

/**
 * Build headers for service setup
 */
export function buildSetupHeaders(serviceName, serviceHome, registryToken = null, rateLimitRequired = false) {
  return {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_SETUP,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_HOME]: serviceHome,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken }),
    ...(rateLimitRequired && { [HEADERS.RATE_LIMIT_REQUIRED]: 'true' })
  }
}

/**
 * Build headers for service registration
 * 
 * Access Control Levels:
 * - 'pure': No HTTP server, direct function call only (same node process)
 * - 'local': HTTP server but accessible only from same node
 * - 'private': HTTP server, accessible from any service (default)
 * - 'public': HTTP server, accessible via gateway (external clients)
 * 
 * Rate Limit Options:
 * - true: Require rate limit config exists on registry (safety check)
 * - false/undefined: No rate limit requirement
 * 
 * TODO: Hybrid rate limiting - allow services to provide fallback config:
 *   rateLimit: { windowMs: 60000, maxRequestsPerIp: 50 }
 * If gateway/registry has no pre-bind for this service, use service's fallback.
 */
export function buildRegisterHeaders(serviceName, location, {
  useAuthService,
  accessControl = 'private', // 'pure', 'local', 'private', 'public'
  registryToken = null,
  rateLimit = false,  // true = require rate limit config exists
  contract = true,
  serviceType = null, // 'sse', etc. -- null means standard
  timeout = null,    // per-service timeout in ms (0 = no timeout)
  metadata = null
} = {}) {
  // TODO: Hybrid rate limiting - if rateLimit is an object, serialize it
  // For now, only support boolean (true = require config exists)
  const rateLimitRequired = rateLimit === true
  const meta =
    metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0
      ? JSON.stringify(metadata)
      : null

  return {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_REGISTER,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_LOCATION]: location,
    ...(useAuthService && { [HEADERS.USE_AUTH_SERVICE]: useAuthService }),
    ...(accessControl && { [HEADERS.ACCESS_CONTROL]: accessControl }),
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken }),
    ...(rateLimitRequired && { [HEADERS.RATE_LIMIT_REQUIRED]: 'true' }),
    ...(contract && { [HEADERS.SERVICE_CONTRACT]: JSON.stringify(contract) }),
    ...(serviceType && { [HEADERS.SERVICE_TYPE]: serviceType }),
    ...(timeout !== null && { [HEADERS.TIMEOUT]: String(timeout) }),
    ...(meta && { [HEADERS.SERVICE_METADATA]: meta })
  }
}

/**
 * Build headers for service unregistration
 */
export function buildUnregisterHeaders(serviceName, location, registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_UNREGISTER,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_LOCATION]: location,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for service lookup
 */
export function buildLookupHeaders(serviceName) {
  return {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
    [HEADERS.SERVICE_NAME]: serviceName
  }
}

/**
 * Build headers for service calls
 */
export function buildCallHeaders(serviceName, authToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
    [HEADERS.SERVICE_NAME]: serviceName,
    ...(authToken && { [HEADERS.AUTH_TOKEN]: authToken })
  }
}

/**
 * Build headers for route registration
 */
export function buildRouteRegisterHeaders(serviceName, routePath, dataType, routeType = 'route', registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.ROUTE_REGISTER,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.ROUTE_PATH]: routePath,
    [HEADERS.ROUTE_DATATYPE]: dataType || 'application/json',
    [HEADERS.ROUTE_TYPE]: routeType,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for route unregistration
 */
export function buildRouteUnregisterHeaders(routePath, registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.ROUTE_UNREGISTER,
    [HEADERS.ROUTE_PATH]: routePath,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for pub/sub publish
 */
export function buildPublishHeaders(channel, registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.PUBSUB_PUBLISH,
    [HEADERS.PUBSUB_CHANNEL]: channel,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for pub/sub subscribe
 */
export function buildSubscribeHeaders(channel, location, registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.PUBSUB_SUBSCRIBE,
    [HEADERS.PUBSUB_CHANNEL]: channel,
    [HEADERS.SERVICE_LOCATION]: location,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for pub/sub unsubscribe
 */
export function buildUnsubscribeHeaders(channel, location, registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.PUBSUB_UNSUBSCRIBE,
    [HEADERS.PUBSUB_CHANNEL]: channel,
    [HEADERS.SERVICE_LOCATION]: location,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for cache update notifications
 */
export function buildCacheUpdateHeaders(pubsubChannel, serviceName, location, registryToken = null, contract = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.CACHE_UPDATE,
    [HEADERS.PUBSUB_CHANNEL]: pubsubChannel,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_LOCATION]: location,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken }),
    ...(contract && { [HEADERS.SERVICE_CONTRACT]: JSON.stringify(contract) })
  }
}

/**
 * Bulk cache update (one POST with JSON body; headers identify command only).
 */
export function buildBulkCacheUpdateHeaders(windowId, registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.CACHE_UPDATE,
    [HEADERS.CACHE_BULK]: '1',
    [HEADERS.CACHE_WINDOW_ID]: windowId,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for registry-issued graceful shutdown to a service HTTP endpoint
 */
export function buildShutdownHeaders(serviceName, location, registryToken, reason = 'registry-broadcast') {
  return {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_SHUTDOWN,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_LOCATION]: location,
    [HEADERS.SHUTDOWN_REASON]: String(reason),
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for gateway registry update notification
 */
export function buildRegistryUpdatedHeaders(registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.REGISTRY_UPDATED,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for gateway registry pull request
 */
export function buildRegistryPullHeaders(registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for gateway state pull request (dev/test only)
 */
export function buildGatewayPullHeaders(registryToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.GATEWAY_PULL,
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
}

/**
 * Build headers for auth login
 */
export function buildAuthLoginHeaders() {
  return {
    [HEADERS.COMMAND]: COMMANDS.AUTH_LOGIN
  }
}

/**
 * Build headers for auth refresh
 */
export function buildAuthRefreshHeaders() {
  return {
    [HEADERS.COMMAND]: COMMANDS.AUTH_REFRESH
  }
}

/**
 * Build headers for auth logout
 */
export function buildAuthLogoutHeaders() {
  return {
    [HEADERS.COMMAND]: COMMANDS.AUTH_LOGOUT
  }
}

/**
 * Parse command headers from request
 * Returns an object with parsed header values
 */
export function parseCommandHeaders(headers) {
  // Parse rate limit required flag
  const rateLimitRequired = headers[HEADERS.RATE_LIMIT_REQUIRED] === 'true'

  // Parse contract from JSON header
  let contract = null
  const contractHeader = headers[HEADERS.SERVICE_CONTRACT]
  if (contractHeader) {
    try { contract = JSON.parse(contractHeader) } catch {}
  }

  let serviceMetadata = null
  const metaHeader = headers[HEADERS.SERVICE_METADATA]
  if (metaHeader) {
    try { serviceMetadata = JSON.parse(metaHeader) } catch {}
  }
  
  // Parse timeout from header (string -> number or null)
  const timeoutHeader = headers[HEADERS.TIMEOUT]
  const timeout = timeoutHeader !== undefined ? Number(timeoutHeader) : null

  return {
    command: headers[HEADERS.COMMAND],
    serviceName: headers[HEADERS.SERVICE_NAME],
    serviceLocation: headers[HEADERS.SERVICE_LOCATION],
    useAuthService: headers[HEADERS.USE_AUTH_SERVICE],
    accessControl: headers[HEADERS.ACCESS_CONTROL],
    serviceHome: headers[HEADERS.SERVICE_HOME],
    routePath: headers[HEADERS.ROUTE_PATH],
    routeDataType: headers[HEADERS.ROUTE_DATATYPE],
    routeType: headers[HEADERS.ROUTE_TYPE],
    pubsubChannel: headers[HEADERS.PUBSUB_CHANNEL],
    rateLimitRequired,
    contract,
    serviceType: headers[HEADERS.SERVICE_TYPE] || null,
    timeout,
    serviceMetadata,
    cacheBulk: headers[HEADERS.CACHE_BULK] === '1',
    cacheWindowId: headers[HEADERS.CACHE_WINDOW_ID] || null
  }
}

/**
 * Check if request uses header-based commands
 */
export function isHeaderBasedCommand(headers) {
  return !!(headers && headers[HEADERS.COMMAND])
}

/**
 * Commands that should NOT JSON parse the body
 * These commands need to preserve raw body data
 */
export const STREAM_COMMANDS = new Set([
  COMMANDS.SERVICE_CALL
])

/**
 * Check if command should skip JSON parsing
 */
export function shouldSkipJsonParsing(command) {
  return STREAM_COMMANDS.has(command)
}

