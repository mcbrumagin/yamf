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
import { getReplicasFor, listServiceLocations } from './replica-helpers.js'
import { createBundleStore } from './bundle-store.js'
import { validateDeployToken } from './registry-auth.js'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { lifecycle } from '../shared/process-lifecycle.js'
import { setDefaultRateLimit, setServiceRateLimit } from '../rate-limiter/rate-limiter.js'
import { validateConfig } from '../rate-limiter/rate-limiter-config.js'
import { registerActiveRegistryServer, unregisterActiveRegistryServer } from './active-registry.js'

const logger = new Logger({ logGroup: 'yamf-registry' })

/**
 * @param {import('http').IncomingMessage} request
 * @param {import('http').ServerResponse} response
 * @param {ReturnType<import('./bundle-store.js').createBundleStore>} bundleStore
 * @returns {boolean} true if the request was handled
 */
function serveBundleFile (request, response, bundleStore) {
  if (request.method !== 'GET') {
    return false
  }
  const u = new URL(request.url || '/', 'http://127.0.0.1')
  const p = u.pathname
  if (!p.startsWith('/bundles/')) {
    return false
  }
  try {
    validateDeployToken(request)
  } catch (e) {
    if (!response.writableEnded) {
      const st = e.status || 500
      response.writeHead(st, { 'content-type': 'text/plain' })
      response.end(e.message)
    }
    return true
  }
  const id = p.slice('/bundles/'.length).replace(/\.mjs$/, '')
  if (!/^sha256-[a-f0-9]+$/i.test(id)) {
    if (!response.writableEnded) {
      response.writeHead(400, { 'content-type': 'text/plain' })
      response.end('Invalid bundle id')
    }
    return true
  }
  let filePath
  try {
    filePath = bundleStore.pathFor(id)
  } catch {
    if (!response.writableEnded) {
      response.writeHead(400, { 'content-type': 'text/plain' })
      response.end('Invalid bundle id')
    }
    return true
  }
  if (!existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('Not found')
    return true
  }
  const st = statSync(filePath)
  response.writeHead(200, {
    'content-type': 'application/javascript; charset=utf-8',
    'content-length': st.size,
    'cache-control': 'public, max-age=31536000, immutable'
  })
  createReadStream(filePath).pipe(response)
  return true
}

/**
 * @param {Record<string, unknown>} [rawOptions] - A single options object; omit or pass `{}` for env-driven defaults
 * @param {number} [rawOptions.port] - Listen port; if omitted, taken from YAMF_REGISTRY_URL
 * @param {boolean} [rawOptions.broadcastShutdownOnTerminate=true] - If true, broadcast shutdown to subscribers on terminate
 * @param {Object} [rawOptions.rateLimit] - Pre-bound rate limit configuration
 * @param {Object} [rawOptions.rateLimit.default] - Default rate limit for all requests
 * @param {Object} [rawOptions.rateLimit.services] - Pre-bound service-specific rate limits
 * @returns {Promise<import('node:http').Server & { terminate: function, isRegistry: boolean, _state: object }>}
 * @example
 * await registryServer({
 *   port: 8080,
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
function normalizeRegistryServerOptions(raw) {
  if (raw === null || raw === undefined) {
    return {}
  }
  if (typeof raw === 'number') {
    throw new TypeError(
      'registryServer: pass a port inside the options object, e.g. registryServer({ port: 8080 })'
    )
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('registryServer: expected a single plain options object')
  }
  return { ...raw }
}

export default async function createRegistryServer(rawOptions) {
  const options = normalizeRegistryServerOptions(rawOptions)
  const { broadcastShutdownOnTerminate = true, rateLimit: rateLimitConfig, bundleDir } = options
  let { port } = options
  /** @type {null | ReturnType<import('./bundle-store.js').createBundleStore>} */
  let bundleStore = 'bundleStore' in options ? options.bundleStore : undefined
  if (bundleStore === undefined) {
    const customRoot = envConfig.get('YAMF_BUNDLE_DIR', null)
    bundleStore = createBundleStore(customRoot != null && customRoot !== '' ? String(customRoot) : bundleDir)
  }
  validateRegistryEnvironment()
  const state = createRegistryState()
  assignRegistryInstanceId(state)
  
  // Initialize rate limit configuration from options
  if (rateLimitConfig) {
    const { default: defaultConfig, services: serviceConfigs } = rateLimitConfig
    
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
  
  // Port: explicit in options, else from YAMF_REGISTRY_URL
  if (port == null) {
    const registryHost = envConfig.getRequired('YAMF_REGISTRY_URL')
    if (registryHost) {
      port = registryHost.split(':')[2]
      if (!port || isNaN(port)) {
        throw new Error(
          'Set options.port, or define YAMF_REGISTRY_URL with protocol and port (e.g. http://localhost:20000)'
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
    if (bundleStore && serveBundleFile(request, response, bundleStore)) {
      return
    }
    let payload = null
    try {
      // Determine if we need to parse the body
      // - PUBSUB_PUBLISH always needs body parsed
      // - SERVICE_CALL needs body parsed if target service has customKeyFn for rate limiting
      // - slice F plugins: `parseJsonBody: false` streams raw body to the handler (e.g. deploy-bundle)
      // TODO we should create a new deployable built-in service to offload customKeyFn processing for rate limits
      const command = request.headers['yamf-command']
      const serviceName = request.headers['yamf-service-name']
      const pluginForCmd = command && state.pluginCommands?.get(command)
      let needsBodyParsing = command === 'pubsub-publish'
      if (command === 'service-call' && serviceName) {
        const serviceConfig = state.rateLimitConfig.services.get(serviceName)
        if (serviceConfig?.customKeyFn) {
          needsBodyParsing = true
        }
      } else if (pluginForCmd) {
        needsBodyParsing = pluginForCmd.parseJsonBody !== false
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
        if (err.code === 'BUNDLE_HASH_MISMATCH' || (status === 422 && (err.message || '').includes('bundle'))) {
          response.writeHead(422, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ code: 'bundle-hash-mismatch', message: err.message || 'bundle-hash-mismatch' }))
        } else {
          const extra = err.responseHeaders && typeof err.responseHeaders === 'object' ? err.responseHeaders : {}
          response.writeHead(status, { 'content-type': 'text/plain', ...extra })
          response.end(err.stack || err.message)
        }
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
  // Late-bound: lifecycle invokes whatever `server.terminate` resolves to at
  // shutdown time so wrappers that override `server.terminate` are honored.
  let unregisterFromLifecycle
  server.terminate = async () => {
    unregisterFromLifecycle?.()
    try {
      await runRegistryShutdown()
    } finally {
      unregisterActiveRegistryServer(server)
    }
  }
  unregisterFromLifecycle = lifecycle.registerTerminable(
    () => server.terminate(),
    { priority: 0 }
  )

  server.isRegistry = true

  registerActiveRegistryServer(server)

  // Expose state for testing
  // Note: In production, access to state should be restricted
  server._state = state
  server._bundleStore = bundleStore
  server.getReplicasFor = (name) => getReplicasFor(state, name)
  server.listHealthyLocations = (name) => listServiceLocations(state, name)
  server.registerCommand = (name, handler, opts) => registerCommand(state, name, handler, opts)
  server.unregisterCommand = (name) => unregisterCommand(state, name)

  // After the server is listening, nudge a pre-existing gateway to re-pull state. This closes
  // the k3s rolling race where a gateway started before a fresh registry had empty state and
  // would otherwise wait for the first service registration to trigger a push.
  // Fire-and-forget: don't block registry readiness on gateway reachability.
  notifyGatewayOfUpdate(state, { service: 'yamf-registry', location: 'registry-ready' }).catch(() => {})

  return server
}
