/**
 * Service Registry
 * Manages service registration, lookup, and lifecycle
 */

import httpRequest from '../http-primitives/http-request.js'
import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'
import { serializeServicesMap, setToArray } from './registry-state.js'
import { publishCacheUpdate, subscribe, removeAllSubscriptionsForLocation } from './pubsub-manager.js'
import { clearRoundRobinForService, getServiceAddresses, selectServiceLocation } from './load-balancer.js'
import { HEADERS, buildShutdownHeaders } from '../shared/yamf-headers.js'
import envConfig from '../shared/env-config.js'
import { isBackwardCompatibleServiceContract, areServiceContractsEqual } from '../service/contract-compatibility.js'
import net from 'node:net'
import { localState } from '../shared/local-state.js'
import readStream from '../http-primitives/read-stream.js'

const logger = new Logger({ logGroup: 'yamf-registry' })

/**
 * Ask every registered non-pure HTTP service to self-terminate (registry shutdown path).
 * Pure services are skipped. Failures (except connection refused) are logged.
 */
export async function broadcastShutdown(state, { reason = 'registry-shutdown' } = {}) {
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  const timeout = Number(envConfig.get('YAMF_SHUTDOWN_BROADCAST_TIMEOUT_MS', 2000))
  const jobs = []
  for (const [service, locations] of state.services) {
    const access = state.serviceAccess.get(service) || 'private'
    if (access === 'pure') continue
    for (const location of locations) {
      if (!location || !location.startsWith('http')) continue
      const h = buildShutdownHeaders(service, location, registryToken, reason)
      jobs.push(
        httpRequest(location, {
          method: 'POST',
          body: {},
          timeout,
          headers: {
            ...h,
            'content-type': 'application/json',
            'mute-internal-error': '1'
          }
        }).catch((err) => {
          if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND') {
            return
          }
          logger.debugErr(`broadcastShutdown: ${service} @ ${location}:`, err.message)
        })
      )
    }
  }
  await Promise.allSettled(jobs)
}

/**
 * Pre-register an already-running Gateway server
 * 
 * The gateway is special: it starts independently and is pre-registered with the registry.
 * This allows the gateway port to be known and accessible before any services register,
 * and enables pull-only updates for enhanced security.
 */
export async function preRegisterGatewayIfItExists(state) {
  const gatewayUrl = envConfig.get('YAMF_GATEWAY_URL')
  const env = envConfig.get('ENVIRONMENT', 'local')
  
  if (gatewayUrl) {
    // Register gateway with special metadata
    await registerService(state, { 
      service: 'yamf-gateway', 
      location: gatewayUrl,
      metadata: {
        preregistered: true,   // Started before registry
        public: true,          // Externally accessible
        pullOnly: true,        // Doesn't receive push updates (security)
        type: 'gateway'        // Service type
      }
    })
    logger.info(`Gateway pre-registered at ${gatewayUrl} (pull-only mode)`)
  } else {
    // No gateway configured
    if (env.includes('prod') || env.includes('staging')) {
      throw new Error(
        'YAMF_GATEWAY_URL required in production/staging. ' +
        'Set this to your publicly accessible gateway endpoint.'
      )
    } else if (env.includes('dev') || env.includes('test')) {
      logger.warn(
        `No YAMF_GATEWAY_URL configured for ENVIRONMENT "${env}". ` +
        `Registry will act as gateway in dev/test/local mode. ` +
        logger.writeColor('red', 'This configuration will fail in production.')
      )
    }
  }
}

// TODO util/helper?
const tryParseJson = text => {
  try {
    return JSON.parse(text)
  } catch (err) {
    return text
  }
}

/**
 * Verify auth token for a service call
 * @param {Object} state - Registry state
 * @param {string} serviceName - Name of the service being called
 * @param {string} authToken - Auth token from request headers
 * @returns {Promise<Object>} Verification result with user context
 */
async function verifyAuthToken(state, serviceName, authToken) {
  // Check if service requires auth
  const authServiceName = state.serviceAuth.get(serviceName)
  if (!authServiceName) {
    return { verified: true } // No auth required
  }
  
  // Check if auth service is registered
  if (!state.services.has(authServiceName)) {
    throw new HttpError(503, `Auth service "${authServiceName}" not found`)
  }
  
  // Missing auth token
  if (!authToken) {
    throw new HttpError(401, 'Authentication token required')
  }
  
  try {
    const authLocation = selectServiceLocation(state, authServiceName, 'round-robin')
    logger.debug('verifyAuthToken - authService:', authServiceName)
    
    const verifyResult = await httpRequest(authLocation, {
      method: 'POST',
      body: { verifyAccess: authToken },
      headers: { 'content-type': 'application/json' }
    })
    
    // Auth service returned error
    if (verifyResult instanceof HttpError) {
      throw verifyResult
    }
    
    // Token verification failed
    // verifyResult.status
    if (verifyResult.error) {// TODO // || !verifyResult.user) {
      const message = verifyResult.message || 'Invalid or expired token'
      throw new HttpError(401, message)
    }
    
    logger.debug('verifyAuthToken - user:', verifyResult.user)
    return { verified: true, user: verifyResult.user }
    
  } catch (error) {
    // Auth service unreachable
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new HttpError(503, `Auth service "${authServiceName}" unavailable`)
    }
    
    // Re-throw known errors
    if (error instanceof HttpError) {
      throw error
    }
    
    logger.debugErr('Auth verification error:', error)
    throw new HttpError(500, 'Authentication verification failed')
  }
}

// TODO logger support for Map, etc
function printState(state) {
  for (let prop in state) {
    let map = state[prop]
    logger.debug(`map[${prop}]`)
    for (let [key, val] of map.entries()) {
      logger.debug(`  ${key}: ${val}`)
    }
  }
}

/**
 * Allocate a port for a new service instance
 * 
 * FIXED: Previously, the function treated domains with ports as separate keys,
 * causing port allocation conflicts. Now it strips ports before using as Map keys.
 */
export function allocateServicePort(state, { service, domain, home }, defaultStartPort = 10000) {
  // Accept both 'home' and 'domain' for backwards compatibility

  logger.debug('allocateServicePort - service:', service)
  let rawServiceHome = home || domain
  
  // CRITICAL FIX: Always strip port from serviceHome before using as Map key
  // This ensures that http://localhost and http://localhost:4000 map to the same entry
  const serviceHome = rawServiceHome.split(':').slice(0, 2).join(':')  // Keep proto://domain only
  
  logger.debug('allocateServicePort - service:', service, 'home:', serviceHome)
  
  // Initialize port tracking for this domain if first time
  if (!state.domainPorts.has(serviceHome)) {
    state.domainPorts.set(serviceHome, defaultStartPort)
  }
  
  // Get next available port for this domain
  const port = state.domainPorts.get(serviceHome)
  
  // Increment for next service on this domain
  state.domainPorts.set(serviceHome, port + 1)
  
  const location = `${serviceHome}:${port}`
  logger.debug('allocateServicePort - allocated:', location)
  
  return location
}

/**
 * Register a service instance
 * @param {Object} state - Registry state
 * @param {Object} options - Registration options
 * @param {string} options.service - Service name
 * @param {string} options.location - Service location URL
 * @param {string} [options.useAuthService] - Auth service name for protected services
 * @param {string} [options.accessControl] - Access control level ('pure', 'local', 'private', 'public')
 * @param {Object} [options.metadata] - Service metadata (for special services like gateway)
 * @param {Object} [options.rateLimit] - Rate limit configuration for this service
 */
export async function registerService(state, { service, location, useAuthService, accessControl, metadata = {}, rateLimit, contract, serviceType, timeout, allowBreakingContract = false }) {
  logger.debug(`registerService - service "${service}" registering for ${location} (accessControl: ${accessControl})`)
  
  const existingContract = state.serviceContracts.get(service)
  if (contract && existingContract && !areServiceContractsEqual(existingContract, contract)) {
    if (!isBackwardCompatibleServiceContract(existingContract, contract) && !allowBreakingContract) {
      throw new HttpError(409,
        `Service "${service}": new registration contract is not backward compatible with the contract already in the registry. ` +
        'Deploy with contract overrides or re-register the old version first, or have the new replica send the yamf-allow-breaking-contract header (e.g. YAMF_DEPLOY_ALLOW_BREAKING=1 in its environment).'
      )
    }
  }
  
  // Check for pure service load-balancing attempt
  if (accessControl === 'pure') {
    if (state.services.has(service)) {
      const existingAccess = state.serviceAccess.get(service)
      if (existingAccess === 'pure') {
        throw new HttpError(409,
          `Pure service "${service}" already exists. ` +
          `Pure services cannot be load-balanced across multiple instances. ` +
          `If load-balancing is needed, use 'private' or 'local' access control instead.`
        )
      } else {
        throw new HttpError(409,
          `Service "${service}" already exists with access control "${existingAccess}". ` +
          `Cannot register a pure service with the same name as an existing non-pure service.`
        )
      }
    }
  }
  
  // Check if registering a non-pure service when a pure service already exists
  if (accessControl !== 'pure' && state.services.has(service)) {
    const existingAccess = state.serviceAccess.get(service)
    if (existingAccess === 'pure') {
      throw new HttpError(409,
        `Cannot register service "${service}" with access control "${accessControl}". ` +
        `A pure service with this name already exists. ` +
        `Either rename the service or change the existing pure service to a different access level.`
      )
    }
  }
  
  // Add to services map
  if (!state.services.has(service)) {
    state.services.set(service, new Set())
  }
  state.services.get(service).add(location)
  
  // Add to reverse lookup
  state.addresses.set(location, service)
  
  // Store auth service mapping if specified
  if (useAuthService) {
    state.serviceAuth.set(service, useAuthService)
    logger.info(`Configured "${service}" to use auth: "${useAuthService}"`)
  }

  // Store access control rules if provided
  if (accessControl) {
    state.serviceAccess.set(service, accessControl)
    logger.info(`Stored access control for "${service}":`, accessControl)
  }
  
  // Store rate limit configuration if provided
  if (rateLimit && typeof rateLimit === 'object') {
    state.serviceRateLimit.set(service, rateLimit)
    logger.info(`Stored rate limit config for "${service}":`, rateLimit)
  }
  
  // Store contract if provided
  if (contract) {
    state.serviceContracts.set(service, contract)
    logger.info(`Stored contract for "${service}": ${JSON.stringify(contract)}`) //enforce=${contract.enforce}, params=${contract.params}, expectedKeys=${contract.expectedKeys}`)
  }

  // Store service type if provided (e.g. 'sse')
  if (serviceType) {
    state.serviceTypes.set(service, serviceType)
    logger.info(`Stored service type for "${service}":`, serviceType)
  }

  // Store per-service timeout if provided (0 = no timeout for long-lived connections)
  if (timeout !== null && timeout !== undefined) {
    state.serviceTimeouts.set(service, timeout)
    logger.info(`Stored timeout for "${service}":`, timeout)
  }

  const replicaKey = `${service}\0${location}`
  const metaObj = metadata && typeof metadata === 'object' ? metadata : {}
  const { sourceHash, configVersion, node, ...metadataForService } = metaObj

  if (sourceHash != null || configVersion != null || node != null) {
    const prevR = state.replicaMetadata.get(replicaKey) || {}
    state.replicaMetadata.set(replicaKey, {
      ...prevR,
      ...(sourceHash != null ? { sourceHash } : {}),
      ...(configVersion != null ? { configVersion: String(configVersion) } : {}),
      ...(node != null ? { node: String(node) } : {}),
      registeredAt: Date.now()
    })
  }

  if (Object.keys(metadataForService).length > 0) {
    // Merges with any prior row; re-registering with a subset does not remove absent keys. To
    // clear a key on re-registration, send an explicit `null` for that key in `yamf-service-metadata`.
    const prev = state.serviceMetadata.get(service) || {}
    state.serviceMetadata.set(service, {
      ...prev,
      ...metadataForService,
      registeredAt: prev.registeredAt || Date.now()
    })
    logger.info(`Stored metadata for "${service}":`, metadataForService)
  }
  
  // Check if this service should receive push notifications
  // Gateway and other pull-only services should not be subscribed to push events
  const isPullOnly = metadataForService.pullOnly === true
  
  // Notify other services about the new registration using cache update headers
  await publishCacheUpdate(state, { service, location, contract: state.serviceContracts.get(service) })
  
  // Subscribe the new service to registration events (unless it's pull-only)
  if (!isPullOnly) {
    // TODO subscribe to "yamf:register"
    await subscribe(state, { type: 'register', location })
  } else {
    logger.info(`Service "${service}" is pull-only, skipping push subscription`)
  }
  
  // Return current registry state
  return {
    services: serializeServicesMap(state.services),
    addresses: Object.fromEntries(state.addresses),
    serviceContracts: Object.fromEntries(state.serviceContracts)
  }
}

/**
 * Unregister a service instance
 * Notifies the gateway (via {@link publishCacheUpdate}) the same as {@link registerService},
 * so pull-only gateways do not keep stale locations — otherwise round-robin can hit a dead
 * address (~50% 502) after rolling deploys.
 */
export async function unregisterService (state, { service, location }) {
  logger.info(`Service "${service}" unregistered from ${location}`)

  state.replicaMetadata?.delete(`${service}\0${location}`)

  // Remove from reverse lookup
  state.addresses.delete(location)
  
  // Remove from services map
  const serviceInstances = state.services.get(service)
  if (!serviceInstances) {
    throw new HttpError(404, `No service by name "${service}"`)
  }
  
  serviceInstances.delete(location)
  clearRoundRobinForService(service)
  
  // Clean up empty service entries
  if (serviceInstances.size === 0) {
    state.services.delete(service)
    // Also remove auth mapping when no instances remain
    state.serviceAuth.delete(service)
  }
  
  // Clean up all subscriptions for this location
  removeAllSubscriptionsForLocation(state, location)

  if (state.pluginCommands?.size) {
    for (const [cmd, entry] of [...state.pluginCommands.entries()]) {
      if (entry.service === service && entry.location === location) {
        state.pluginCommands.delete(cmd)
        logger.debug(`unregisterService: removed plugin command "${cmd}"`)
      }
    }
  }

  await publishCacheUpdate(state, {
    service,
    location,
    contract: state.serviceContracts.get(service)
  })
}

/**
 * Find a service location (with optional strategy)
 * Returns a single location or all services
 */
export function findServiceLocation(state, serviceName, strategy = 'random') {
  logger.debug('findServiceLocation - service:', serviceName)
  
  // Special case: return all services
  if (serviceName === '*') {
    return serializeServicesMap(state.services)
  }
  
  // Find a single service instance
  return selectServiceLocation(state, serviceName, strategy)
}

const validateServiceCall = (state, name) => {
  if (!name) {
    throw new HttpError(400, 'Proxy call requires service "name" property')
  }
  if (!state.services.has(name)) {
    throw new HttpError(404, `No service by name "${name}"`)
  }
}

const parseForwardedHeader = (forwarded) => {
  let result = {}
  if (forwarded) {
    const parts = forwarded.split(';')
    for (const part of parts) {
      const [key, value] = part.split('=')
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1)
      }
      result[key] = value
    }
  }
  return result
}

const writeForwardedHeaders = (request, headers) => {
  // prefer forwarded header over x-forwarded headers
  let forwardedDetails = parseForwardedHeader(request.headers['forwarded'])
  
  let senderAddress = forwardedDetails?.for || request.headers['x-forwarded-for']

  let isAlreadyForwarded = !!forwardedDetails?.for

  if (!senderAddress) {
    let { remoteAddress, remotePort } = request.socket
    senderAddress = remoteAddress
    if (!net.isIPv4(senderAddress)) senderAddress = `[${senderAddress}]`
    senderAddress += remotePort ? `:${remotePort}` : ''
  }

  // begin building modern forwarded header
  let forwarded = `for="${senderAddress}"`

  let serverAddress = request.socket.address()
  let { address, family, port} = serverAddress

  if (family === 'IPv6') address = `[${address}]:${port}`
  else address = `${address}:${port}`

  // TODO verify this is correctly formatted in each case... this would be a good spot for unit tests
  let by = forwarded.by || request.headers['x-forwarded-by']
  if (by) by += `,${address}` // append additional proxy if there is one already
  else by = address

  forwarded += `;by="${by}"`
  headers['X-Forwarded-By'] = by // including x-forwarded headers for backwards compatibility

  let host = forwardedDetails.host || request.headers.host
  if (host) { // the original host requested by the client
    forwarded += `;host=${host}`
    headers['X-Forwarded-Host'] = host
  }

  let proto = forwardedDetails.proto || request.headers['x-forwarded-proto']
  if (proto) { // the original protocol requested by the client
    forwarded += `;proto=${proto}`
    headers['X-Forwarded-Proto'] = proto
  }

  logger.debug('writing forwarded header - forwarded:', forwarded)
  headers['Forwarded'] = forwarded
}

const headerWhitelist = [
  'accept',
  'accept-language',
  'connection',
  'content-type',
  'origin',
  'referer',
  'forwarded',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'user-agent',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',

  // Range request headers for streaming media
  'range',
  'if-range',
  'accept-ranges',

  // SSE-specific headers
  'last-event-id',
  'cache-control',

  // TODO verify relevant yamf-headers are forwarded
  'cookie', // TODO only for auth services
  'yamf-command',
  'yamf-service-name',
  'yamf-auth-token',
  'yamf-registry-token',
  'yamf-deploy-token',
  'yamf-deploy-hash',
  'yamf-bundle-ed25519-sig',
  'yamf-prefer-service-location'
]

const filterForUsefulHeaders = (headers) => {
  const filteredHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!headerWhitelist.includes(key.toLowerCase())) continue
    filteredHeaders[key] = value
  }
  return filteredHeaders
}

/**
 * Stream proxy a call to a service (for large payloads, multipart, etc.)
 * Pipes the request stream directly to the service without buffering
 */
export async function streamProxyServiceCall(state, { name, request, response }) {
  const http = (await import('node:http')).default
  
  validateServiceCall(state, name)

  // Verify auth token if service requires authentication
  const authToken = request.headers?.[HEADERS.AUTH_TOKEN]
  await verifyAuthToken(state, name, authToken)

  // use round-robin for proxy calls; optional sticky routing for multi-replica (e.g. remote pm3 CLI)
  const prefer = request.headers?.[HEADERS.SERVICE_PREFER_LOCATION]
  let location
  if (prefer) {
    try {
      const addrs = getServiceAddresses(state, name)
      location = addrs.includes(prefer) ? prefer : selectServiceLocation(state, name, 'round-robin')
    } catch {
      location = selectServiceLocation(state, name, 'round-robin')
    }
  } else {
    location = selectServiceLocation(state, name, 'round-robin')
  }
  const endpoint = request.url
  const url = new URL(location + (endpoint ? endpoint : ''))

  logger.debug('streamProxyServiceCall - location:', location)

  const headers = filterForUsefulHeaders(request.headers)
  writeForwardedHeaders(request, headers)

  // Look up per-service timeout (0 = no timeout for SSE/long-lived connections)
  const serviceTimeout = state.serviceTimeouts?.get(name)

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: request.method,
      headers: {
        ...headers,
        host: url.host
      }
    }

    if (serviceTimeout === 0) {
      options.timeout = 0
    }

    const proxyReq = http.request(options, (proxyRes) => {
      // Detect SSE responses and disable socket timeouts to keep connection alive
      const contentType = proxyRes.headers['content-type'] || ''
      const isSSE = contentType.includes('text/event-stream')
      if (isSSE) {
        logger.debug(`streamProxyServiceCall - SSE connection detected for "${name}", disabling socket timeouts`)
        if (request.socket) request.socket.setTimeout(0)
        if (response.socket) response.socket.setTimeout(0)
        if (proxyReq.socket) proxyReq.socket.setTimeout(0)
      }

      // Forward status code and headers to client
      response.writeHead(proxyRes.statusCode, proxyRes.headers)
      
      // Pipe response body directly to client
      proxyRes.pipe(response)
      
      proxyRes.on('end', () => {
        logger.debug('streamProxyServiceCall - complete')
        resolve(false)
      })
      
      proxyRes.on('error', (err) => {
        logger.debugErr('Proxy response error:', err)
        if (!response.writableEnded) {
          response.end()
        }
        if (response.writableEnded) {
          resolve(false)
        } else {
          reject(err)
        }
      })
    })

    proxyReq.on('error', (err) => {
      logger.debugErr('Proxy request error:', err)
      if (!response.headersSent) {
        response.writeHead(502)
        response.end('Bad Gateway')
        reject(err)
      } else {
        logger.error('Proxy request error after response started:', err)
        if (!response.writableEnded) {
          response.end()
        }
        resolve(false)
      }
    })

    request.on('error', (err) => {
      logger.debugErr('Request stream error:', err)
      proxyReq.destroy()
      if (!response.headersSent) {
        reject(err)
      } else {
        logger.error('Request stream error after response started:', err)
        resolve(false)
      }
    })

    request.on('end', () => {
      logger.debug('streamProxyServiceCall - request stream ended')
    })

    // TODO remove this once we have a new built-in service to offload customKeyFn processing for rate limits
    if (request._parsedBody !== undefined) {
      const bodyData = typeof request._parsedBody === 'string' 
        ? request._parsedBody 
        : JSON.stringify(request._parsedBody)
      proxyReq.write(bodyData)
      proxyReq.end()
      logger.debug('streamProxyServiceCall - sent parsed body')
    } else {
      request.pipe(proxyReq, { end: true })
    }
  }).catch(err => {
    logger.debugErr('Caught unhandled error in streamProxyServiceCall:', err)
    if (!response.headersSent && !response.writableEnded) {
      try {
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(err.message || 'Internal Server Error')
      } catch (writeErr) {
        logger.error('Failed to send error response:', writeErr)
      }
    }
    return false
  })
}
