/**
 * Yamf wire protocol — headers, command verbs, and well-known pub/sub channels.
 *
 * The `yamf-` prefix on header names and the `yamf:` prefix on pub/sub channel names are
 * **reserved** for the framework. Apps must not invent their own `yamf-*` headers or
 * `yamf:*` channels; that namespace is owned by the wire protocol and may grow with
 * future framework releases.
 *
 * Boolean-valued headers always serialize as the strings `'true'` / `'false'`. Absent
 * headers parse as `false`. Use `parseCommandHeaders` to normalize an incoming request
 * into a single typed bag.
 */

/**
 * Header name constants. Grouped by concern; the value is the wire-level lowercase header.
 */
export const HEADERS = {
  // Routing
  COMMAND: 'yamf-command',

  // Service identity / placement
  SERVICE_NAME: 'yamf-service-name',
  SERVICE_LOCATION: 'yamf-service-location',
  SERVICE_HOME: 'yamf-service-home',
  /** When set, registry SERVICE_CALL may sticky-route to this pm3 location (must be a registered location for the service). */
  SERVICE_PREFER_LOCATION: 'yamf-service-prefer-location',
  USE_AUTH_SERVICE: 'yamf-use-auth-service',
  ACCESS_CONTROL: 'yamf-access-control', // 'pure' | 'local' | 'private' | 'public'
  SERVICE_TYPE: 'yamf-service-type',     // 'standard' | 'sse' | 'auth-service' | …
  /** Per-service timeout in ms (0 = no timeout, e.g. SSE). */
  TIMEOUT: 'yamf-timeout',
  /** JSON-encoded `{ cacheBulk?: boolean, ... }`. */
  SERVICE_METADATA: 'yamf-service-metadata',

  // Authentication / authorization
  AUTH_TOKEN: 'yamf-auth-token',
  REGISTRY_TOKEN: 'yamf-registry-token',
  DEPLOY_TOKEN: 'yamf-deploy-token',

  // Deploy bundle (slice C3 + C6)
  /** sha256 content hash of the streamed bundle (e.g. `sha256-…`). */
  DEPLOY_HASH: 'yamf-deploy-hash',
  /** Opaque deploy actor (e.g. `user@host`). */
  DEPLOYER: 'yamf-deployer',
  /** base64 signature over the UTF-8 hash string. Algorithm in {@link HEADERS.BUNDLE_SIGNATURE_ALG}. */
  BUNDLE_SIGNATURE: 'yamf-bundle-signature',
  /** Signature algorithm tag; defaults to `ed25519` when absent. */
  BUNDLE_SIGNATURE_ALG: 'yamf-bundle-signature-alg',

  // Routes (registration only — runtime routing is URL-based)
  ROUTE_PATH: 'yamf-route-path',
  ROUTE_DATATYPE: 'yamf-route-datatype',
  /** `'route'` (exact match) or `'controller'` (path-prefix match: `/api/` matches `/api/users`). */
  ROUTE_TYPE: 'yamf-route-type',

  // Pub/sub
  PUBSUB_CHANNEL: 'yamf-pubsub-channel',

  // Rate limiting
  /** `'true'` if a registering service requires rate-limit config to exist on the registry. */
  RATE_LIMIT_REQUIRED: 'yamf-rate-limit-required',

  // Service contracts (cross-cut 2)
  /** JSON-serialized contract object. */
  SERVICE_CONTRACT: 'yamf-service-contract',
  /** `'true'` to allow a registering replica's contract to break compatibility. */
  ALLOW_BREAKING_CONTRACT: 'yamf-allow-breaking-contract',

  // Rolling registry
  REGISTRY_INSTANCE_ID: 'yamf-registry-instance-id',
  SHUTDOWN_REASON: 'yamf-shutdown-reason',

  // Bulk cache update window (registry → subscriber)
  /** Present iff this CACHE_UPDATE call carries a bulk window in the body. */
  CACHE_WINDOW_ID: 'yamf-cache-window-id'
}

/**
 * Reserved framework pub/sub channels. App-defined channels must not collide with the
 * `yamf:` namespace.
 */
export const CHANNELS = {
  /** Published by `yamf dev` after a successful (re)deploy; consumed by `@yamf/services-dev-hmr`. */
  DEV_RELOAD: 'yamf:dev-reload',
  /** Published by registry deploy-router on every deploy decision (audit/observability stream). */
  DEPLOY: 'yamf:deploy',
  /** Reserved for upload-service progress events. */
  UPLOAD: 'yamf:upload'
}

/**
 * @deprecated since v1.x — use {@link CHANNELS.DEV_RELOAD}. Will be removed at the next major.
 */
export const PUBSUB_CHANNEL_YAMF_DEV_RELOAD = CHANNELS.DEV_RELOAD

/**
 * `yamf-command` header verbs. Built-in values are reserved (see {@link RESERVED_COMMANDS}).
 * Plugins register additional verbs via {@code registry.registerCommand(name, handler, …)}.
 */
export const COMMANDS = {
  // Universal
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
  REGISTRY_UPDATED: 'registry-updated',
  REGISTRY_PULL: 'registry-pull',
  GATEWAY_PULL: 'gateway-pull',

  // Authentication (proxied by registry to a registered auth-service)
  AUTH_LOGIN: 'auth-login',
  AUTH_REFRESH: 'auth-refresh',
  AUTH_LOGOUT: 'auth-logout',

  // Service lifecycle
  CACHE_UPDATE: 'cache-update',
  SERVICE_SHUTDOWN: 'service-shutdown',

  // Rolling registry handoff
  REGISTRY_DRAIN: 'registry-drain',
  /** Fan out {@link COMMANDS.SERVICE_SHUTDOWN} to every registered HTTP service (registry stays up). */
  REGISTRY_BROADCAST_SHUTDOWN: 'registry-broadcast-shutdown',

  // Server-rendered handler round-trip (SSR invoke)
  SSR_INVOKE_HANDLER: 'ssr-invoke-handler'
}

const TRUE_HEADER = 'true'

const isTruthyHeader = (v) => v === TRUE_HEADER

// ---------------------------------------------------------------------------
// Header builders — each returns a fresh object that can be spread onto an HTTP
// request. All builders consistently include the registry token only when set,
// and stringify booleans as `'true'`/`'false'`.
// ---------------------------------------------------------------------------

const withRegistryToken = (headers, registryToken) =>
  registryToken ? { ...headers, [HEADERS.REGISTRY_TOKEN]: registryToken } : headers

export function buildSetupHeaders (serviceName, serviceHome, registryToken = null, rateLimitRequired = false) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.SERVICE_SETUP,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_HOME]: serviceHome,
    ...(rateLimitRequired && { [HEADERS.RATE_LIMIT_REQUIRED]: TRUE_HEADER })
  }, registryToken)
}

/**
 * Build headers for `service-register`.
 *
 * Access control levels:
 * - `pure`    — no HTTP server, direct in-process call only
 * - `local`   — HTTP server but accessible only from the same node
 * - `private` — HTTP server, accessible from any service (default)
 * - `public`  — HTTP server, accessible via gateway (external clients)
 */
export function buildRegisterHeaders (serviceName, location, {
  useAuthService,
  accessControl = 'private',
  registryToken = null,
  rateLimit = false,
  contract = true,
  serviceType = null,
  timeout = null,
  metadata = null,
  allowBreakingContract = false
} = {}) {
  const rateLimitRequired = rateLimit === true
  const meta =
    metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0
      ? JSON.stringify(metadata)
      : null

  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.SERVICE_REGISTER,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_LOCATION]: location,
    ...(useAuthService && { [HEADERS.USE_AUTH_SERVICE]: useAuthService }),
    ...(accessControl && { [HEADERS.ACCESS_CONTROL]: accessControl }),
    ...(rateLimitRequired && { [HEADERS.RATE_LIMIT_REQUIRED]: TRUE_HEADER }),
    ...(contract && { [HEADERS.SERVICE_CONTRACT]: JSON.stringify(contract) }),
    ...(serviceType && { [HEADERS.SERVICE_TYPE]: serviceType }),
    ...(timeout !== null && { [HEADERS.TIMEOUT]: String(timeout) }),
    ...(meta && { [HEADERS.SERVICE_METADATA]: meta }),
    ...(allowBreakingContract && { [HEADERS.ALLOW_BREAKING_CONTRACT]: TRUE_HEADER })
  }, registryToken)
}

export function buildUnregisterHeaders (serviceName, location, registryToken = null) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.SERVICE_UNREGISTER,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_LOCATION]: location
  }, registryToken)
}

export function buildLookupHeaders (serviceName) {
  return {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
    [HEADERS.SERVICE_NAME]: serviceName
  }
}

export function buildCallHeaders (serviceName, authToken = null) {
  return {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
    [HEADERS.SERVICE_NAME]: serviceName,
    ...(authToken && { [HEADERS.AUTH_TOKEN]: authToken })
  }
}

export function buildRouteRegisterHeaders (serviceName, routePath, dataType, routeType = 'route', registryToken = null) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.ROUTE_REGISTER,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.ROUTE_PATH]: routePath,
    [HEADERS.ROUTE_DATATYPE]: dataType || 'application/json',
    [HEADERS.ROUTE_TYPE]: routeType
  }, registryToken)
}

export function buildRouteUnregisterHeaders (routePath, registryToken = null) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.ROUTE_UNREGISTER,
    [HEADERS.ROUTE_PATH]: routePath
  }, registryToken)
}

export function buildPublishHeaders (channel, registryToken = null) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.PUBSUB_PUBLISH,
    [HEADERS.PUBSUB_CHANNEL]: channel
  }, registryToken)
}

export function buildSubscribeHeaders (channel, location, registryToken = null) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.PUBSUB_SUBSCRIBE,
    [HEADERS.PUBSUB_CHANNEL]: channel,
    [HEADERS.SERVICE_LOCATION]: location
  }, registryToken)
}

export function buildUnsubscribeHeaders (channel, location, registryToken = null) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.PUBSUB_UNSUBSCRIBE,
    [HEADERS.PUBSUB_CHANNEL]: channel,
    [HEADERS.SERVICE_LOCATION]: location
  }, registryToken)
}

export function buildCacheUpdateHeaders (pubsubChannel, serviceName, location, registryToken = null, contract = null) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.CACHE_UPDATE,
    [HEADERS.PUBSUB_CHANNEL]: pubsubChannel,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_LOCATION]: location,
    ...(contract && { [HEADERS.SERVICE_CONTRACT]: JSON.stringify(contract) })
  }, registryToken)
}

/**
 * Bulk cache update (one POST with JSON body listing updates).
 * Subscribers detect bulk by presence of {@link HEADERS.CACHE_WINDOW_ID}.
 */
export function buildBulkCacheUpdateHeaders (windowId, registryToken = null) {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.CACHE_UPDATE,
    [HEADERS.CACHE_WINDOW_ID]: windowId
  }, registryToken)
}

export function buildShutdownHeaders (serviceName, location, registryToken, reason = 'registry-broadcast') {
  return withRegistryToken({
    [HEADERS.COMMAND]: COMMANDS.SERVICE_SHUTDOWN,
    [HEADERS.SERVICE_NAME]: serviceName,
    [HEADERS.SERVICE_LOCATION]: location,
    [HEADERS.SHUTDOWN_REASON]: String(reason)
  }, registryToken)
}

export function buildRegistryUpdatedHeaders (registryToken = null) {
  return withRegistryToken({ [HEADERS.COMMAND]: COMMANDS.REGISTRY_UPDATED }, registryToken)
}

export function buildRegistryPullHeaders (registryToken = null) {
  return withRegistryToken({ [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL }, registryToken)
}

export function buildGatewayPullHeaders (registryToken = null) {
  return withRegistryToken({ [HEADERS.COMMAND]: COMMANDS.GATEWAY_PULL }, registryToken)
}

export function buildAuthLoginHeaders () {
  return { [HEADERS.COMMAND]: COMMANDS.AUTH_LOGIN }
}

export function buildAuthRefreshHeaders () {
  return { [HEADERS.COMMAND]: COMMANDS.AUTH_REFRESH }
}

export function buildAuthLogoutHeaders () {
  return { [HEADERS.COMMAND]: COMMANDS.AUTH_LOGOUT }
}

/**
 * Normalize incoming request headers into a typed bag of yamf protocol fields.
 *
 * `cacheWindowId` is non-null when the request is a bulk CACHE_UPDATE — subscribers can
 * branch on that alone (no separate flag header).
 */
export function parseCommandHeaders (headers) {
  let contract = null
  const contractHeader = headers[HEADERS.SERVICE_CONTRACT]
  if (contractHeader) {
    try { contract = JSON.parse(contractHeader) } catch { /* malformed contract header — leave null */ }
  }

  let serviceMetadata = null
  const metaHeader = headers[HEADERS.SERVICE_METADATA]
  if (metaHeader) {
    try { serviceMetadata = JSON.parse(metaHeader) } catch { /* malformed metadata header — leave null */ }
  }

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
    rateLimitRequired: isTruthyHeader(headers[HEADERS.RATE_LIMIT_REQUIRED]),
    contract,
    serviceType: headers[HEADERS.SERVICE_TYPE] || null,
    timeout,
    serviceMetadata,
    cacheWindowId: headers[HEADERS.CACHE_WINDOW_ID] || null,
    allowBreakingContract: isTruthyHeader(headers[HEADERS.ALLOW_BREAKING_CONTRACT])
  }
}

/** True if a request carries a `yamf-command` header. */
export function isHeaderBasedCommand (headers) {
  return !!(headers && headers[HEADERS.COMMAND])
}

/**
 * Commands that should not pre-parse the request body as JSON (raw stream proxied through).
 */
export const STREAM_COMMANDS = new Set([
  COMMANDS.SERVICE_CALL
])

export function shouldSkipJsonParsing (command) {
  return STREAM_COMMANDS.has(command)
}

/** Built-in command verbs are reserved; plugins must not re-register these. */
export const RESERVED_COMMANDS = new Set(Object.values(COMMANDS))
