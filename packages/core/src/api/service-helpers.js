/**
 * Service Helpers
 * Shared utilities for service and subscription service creation
 * Handles common registry operations and HTTP server lifecycle
 */

import httpServer from '../http-primitives/http-server.js'
import httpRequest from '../http-primitives/http-request.js'
import envConfig, { envTruthy } from '../shared/env-config.js'
import retry from '../shared/retry-helper.js'
import { buildSetupHeaders, buildRegisterHeaders, buildUnregisterHeaders } from '../shared/yamf-headers.js'
import Logger from '../utils/logger.js'
import { hasLocalService, getLocalServiceAccess } from '../shared/local-state.js'

const logger = new Logger({ logGroup: 'yamf-service-helpers' })

function allowBreakingContractFromEnv () {
  return envTruthy(envConfig.get('YAMF_DEPLOY_ALLOW_BREAKING', false))
}

/**
 * Default configuration for service operations
 */
const DEFAULT_RETRY_CONFIG = {
  tryRegisterLimit: envConfig.get('YAMF_RETRY_LIMIT', 3),
  retryInitialDelay: envConfig.get('YAMF_RETRY_DELAY_MS', envConfig.get('YAMF_RETRY_DELAY', 100)),
  muteRetryWarnings: envConfig.get('YAMF_MUTE_RETRY_WARNINGS', false)
}

/**
 * Get registry configuration
 * @returns {Object} { registryHost, registryToken, serviceHome }
 */
export function getRegistryConfig() {
  const serviceHost = envConfig.get('YAMF_SERVICE_URL')
  const registryHost = envConfig.getRequired('YAMF_REGISTRY_URL')
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  return { serviceHost, registryHost, registryToken }
}

function getServiceHomeFromConfig(serviceHost, registryHost) {
  serviceHost = envConfig.get('YAMF_SERVICE_URL', serviceHost)
  registryHost = envConfig.getRequired('YAMF_REGISTRY_URL', registryHost)

  let serviceHome
  if (serviceHost) {
    serviceHome = serviceHost
    // include port so the registry can figure out what this host has setup already
    // NOTE skip port remove? // TODO REFACTOR
    // serviceHome = serviceHost.replace(/:\d+$/, '')
    logger.info(`setting service home "${serviceHome}" for serivceHost "${serviceHost}"`)
  } else {
    serviceHome = registryHost.replace(/:\d+$/, '')
    logger.info(`setting service home "${serviceHome}" for registryHost "${registryHost}"`)
  }
  
  return { serviceHost, registryHost, serviceHome }
}

/**
 * Validate service location format
 * @param {string} location - Service location to validate
 * @param {string} port - Expected port number
 * @throws {Error} If location is invalid
 */
export function validateServiceLocation(location, port) {
  if (!location || !location.startsWith('http')) {
    throw new Error(`Invalid service location: ${location}`)
  }
  if (!port || isNaN(parseInt(port))) {
    throw new Error(`Invalid port in location: ${location}`)
  }
}

/**
 * Validate service name
 * @param {string} name - Service name to validate
 * @throws {Error} If name is invalid
 */
export function validateServiceName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Service name must be a non-empty string')
  }
  if (name.includes(' ')) {
    throw new Error('Service name cannot contain spaces')
  }
}

/**
 * Setup service with registry - allocate port
 * @param {string} serviceName - Name of the service
 * @param {string} serviceHome - Service home URL
 * @param {Object} options - Configuration options
 * @returns {Promise<string>} Allocated location (e.g. 'http://localhost:3001')
 */
export async function setupServiceWithRegistry(serviceName, serviceHome, options = {}) {
  const { registryHost, registryToken } = getRegistryConfig()
  const config = { ...DEFAULT_RETRY_CONFIG, ...options }
  
  logger.debug(`setupServiceWithRegistry - ${serviceName}`)
  
  return await retry(
    async () => {
      const location = await httpRequest(registryHost, {
        headers: buildSetupHeaders(serviceName, serviceHome, registryToken, !!config.rateLimit)
      })
      return location
    },
    {
      maxAttempts: config.tryRegisterLimit,
      initialDelay: config.retryInitialDelay,
      muteWarnings: config.muteRetryWarnings
    }
  )
}

/**
 * Register service with registry
 * @param {string} serviceName - Name of the service
 * @param {string} location - Service location (e.g. 'http://localhost:3001')
 * @param {Object} options - Registration options
 * @param {boolean} [options.rateLimit] - If true, require rate limit config exists on registry
 * @returns {Promise<Object>} Registry data (services, addresses)
 */
export async function registerServiceWithRegistry(serviceName, location, options = {}) {
  const { registryHost, registryToken } = getRegistryConfig()
  const { useAuthService, accessControl, rateLimit, contract, serviceType, timeout, metadata: metadataOpt } = options

  const sourceHash = envConfig.get('YAMF_SOURCE_HASH', null)
  const configVersion = envConfig.get('YAMF_CONFIG_VERSION', null)
  const nodeId = envConfig.get('YAMF_NODE_ID', null)
  let metadata = metadataOpt
  if (sourceHash || configVersion || nodeId) {
    metadata = {
      ...(metadataOpt && typeof metadataOpt === 'object' ? metadataOpt : {}),
      ...(sourceHash ? { sourceHash: String(sourceHash) } : {}),
      ...(configVersion != null && configVersion !== ''
        ? { configVersion: String(configVersion) }
        : {}),
      ...(nodeId != null && nodeId !== '' ? { nodeId: String(nodeId) } : {})
    }
  }

  logger.debug(`registerServiceWithRegistry - ${serviceName} at ${location}`)

  // TODO build pubsubChannels header for createSubscriptionService?
  return await httpRequest(registryHost, {
    headers: buildRegisterHeaders(serviceName, location, {
      useAuthService,
      accessControl,
      registryToken,
      rateLimit,
      contract,
      serviceType,
      timeout,
      metadata,
      allowBreakingContract: allowBreakingContractFromEnv()
    })
  })
}

/**
 * Notify registry of a pure service (for observability only).
 * Pure services don't have HTTP servers, but we notify the registry so:
 * 1. Other nodes know the name is taken
 * 2. Observability tools can track all services
 *
 * This function **never throws**: any failure (including no YAMF_REGISTRY_URL set) is logged
 * and returns `null`. Callers do not need their own try/catch.
 *
 * @param {string} serviceName - Name of the service
 * @param {Object} options - Service options
 * @returns {Promise<Object|null>} Registry data or null if notification fails / no registry URL
 */
export async function notifyRegistryOfPureService(serviceName, options = {}) {
  try {
    const { registryHost, registryToken } = getRegistryConfig()
    const { useAuthService, contract } = options
    logger.debug(`notifyRegistryOfPureService - ${serviceName}`)
    return await httpRequest(registryHost, {
      headers: buildRegisterHeaders(serviceName, 'pure://local', {
        useAuthService,
        accessControl: 'pure',
        registryToken,
        contract,
        allowBreakingContract: allowBreakingContractFromEnv()
      })
    })
  } catch (err) {
    logger.warn(`Failed to notify registry of pure service "${serviceName}":`, err.message)
    return null
  }
}

/**
 * Unregister service from registry
 * @param {string} serviceName - Name of the service
 * @param {string} location - Service location
 * @returns {Promise<void>}
 */
export async function unregisterServiceFromRegistry(serviceName, location) {
  const { registryHost, registryToken } = getRegistryConfig()
  
  logger.debug(`unregisterServiceFromRegistry - ${serviceName} from ${location}`)
  
  return await httpRequest(registryHost, {
    headers: buildUnregisterHeaders(serviceName, location, registryToken)
  })
}

/**
 * Create HTTP server for service
 * @param {number|string} port - Port number
 * @param {Function} handler - Request handler function
 * @param {Object} options - Server options
 * @returns {Promise<Object>} HTTP server instance
 */
export async function createServiceHttpServer(port, handler, options = {}) {
  logger.debug(`createServiceHttpServer - port: ${port}`)
  return await httpServer(port, handler, options)
}

/**
 * Complete service lifecycle: setup, create server, register
 * This orchestrates the common pattern for both regular and subscription services
 * 
 * @param {string} serviceName - Name of the service
 * @param {Function} handler - Request handler function
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Service instance with { name, location, port, server, registryData }
 */
const serviceRegistrationRetryLimit = envConfig.get('YAMF_REGISTRATION_RETRY_LIMIT', 120)
export async function createAndRegisterService(serviceName, handler, options = {}, retryInfo) {
  options = {
    ...options,
    metadata: { cacheBulk: true, ...(options.metadata || {}) }
  }
  validateServiceName(serviceName)
  
  // Check for local service name collision before proceeding
  // This prevents issues if accessControl is changed later
  if (hasLocalService(serviceName) && !retryInfo) {
    const existingAccess = getLocalServiceAccess(serviceName)
    // Only error if the existing service is pure (no HTTP server)
    // If it has an HTTP server, it's the same service being registered (recursive retry)
    if (existingAccess === 'pure') {
      throw new Error(
        `Cannot create service "${serviceName}" with HTTP server. ` +
        `A pure service with this name already exists on this node.\n` +
        `Options:\n` +
        `  - Rename one of the services\n` +
        `  - Change the pure service to use 'private' or 'local' access control\n` +
        `  - Use a plain function instead of a pure service`
      )
    }
  }

  /**
   * TODO need bug analysis and fix for dynamic ports
   * when running multiple services at localhost:4000-4018
   * orchestrating second service run (using 127.0.0.1:3998 to simulate a different host)
   * the registry leaves some 
   * 
    yamf-registry | map[domainPorts]
    yamf-registry |   http://localhost: 4019 <--- normal initial registry home + services run
    yamf-registry |   http://127.0.0.1:3998: 4001 <--- problem state, will cause more errors for next service
    yamf-registry |   http://127.0.0.1:4000: 4020 <--- this service home doesn't make sense though either

    ---another example with 127.0.0.1:3999---
    yamf-registry | map[domainPorts]
    yamf-registry |   http://localhost: 4019
    yamf-registry |   http://127.0.0.1:3999: 4002
    yamf-registry |   http://127.0.0.1:4000: 4020
    yamf-registry |   http://127.0.0.1:4001: 4021
   *
   */
  const { serviceHome } = retryInfo || getServiceHomeFromConfig()
  
  // 1. Setup with registry (allocate port)
  const location = await setupServiceWithRegistry(serviceName, serviceHome, options)
  const port = location.split(':')[2]
  validateServiceLocation(location, port)
  
  // 2. Create HTTP server
  let server
  const serverOptions = { streamPayload: options.streamPayload || false }
  if (options.requestTimeout !== undefined) serverOptions.requestTimeout = options.requestTimeout
  if (options.headersTimeout !== undefined) serverOptions.headersTimeout = options.headersTimeout
  if (options.csp !== undefined) serverOptions.csp = options.csp
  if (options.frameOptions !== undefined) serverOptions.frameOptions = options.frameOptions
  try {
    server = await createServiceHttpServer(port, handler, serverOptions)
  } catch (err) {
    // Handle port collision - retry with new port
    if (err.message.includes('listen EADDRINUSE')) {
      // TODO need to tell registry the setup failed so it can clean up and blacklist ports
      // the actual service registrations are valid, but the domainPorts map gets ugly
      logger.debug(`Port ${port} in use, retrying w/ ${port+1}`)
      if (!retryInfo) {
        retryInfo = {
          attempts: 0,
          limit: serviceRegistrationRetryLimit,
          serviceHome: location.split(':').slice(0,2).join(':') + ':' + port
          // NOTE registry increments port on setup... maybe it shouldn't?
        }
      } else retryInfo.attempts++

      if (retryInfo.attempts >= retryInfo.limit) throw err
      return await createAndRegisterService(serviceName, handler, options, retryInfo)
      // throw err // Let caller handle retry
    }
    throw err
  }
  
  // 3. Register with registry
  const registryData = await registerServiceWithRegistry(serviceName, location, options)
  
  logger.debug(`createAndRegisterService - ${serviceName} successfully created at ${location}`)
  
  return {
    name: serviceName,
    location,
    port,
    server,
    registryData
  }
}

