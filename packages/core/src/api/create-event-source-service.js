/**
 * Create SSE Service
 * Dedicated service for Server-Sent Events (SSE) connections
 * Manages long-lived client connections and pushes events in SSE format
 * 
 * SSE services own their client connections and decide when/what to push.
 * They can optionally subscribe to pubsub channels to forward events to clients.
 * 
 * Access Control Levels:
 * - 'private': HTTP server, accessible from any service (default)
 * - 'public': HTTP server, accessible via gateway (external clients)
 * 
 * Note: 'pure' and 'local' are not supported for SSE services since
 * they require HTTP connections for client streaming.
 */

import Logger from '../utils/logger.js'
import crypto from 'crypto'
import { COMMANDS, parseCommandHeaders } from '../shared/yamf-headers.js'
import { createPubSubManager } from '../service/pubsub-manager.js'
import { createServiceState, updateCache, removeFromCache } from '../service/service-state.js'
import { buildEnhancedContext, updateContext, bindServiceFunction } from '../service/service-context.js'
import { createCacheAwareHandler } from '../service/cache-handler.js'
import { lifecycle } from '../shared/process-lifecycle.js'
import {
  createAndRegisterService,
  unregisterServiceFromRegistry
} from './service-helpers.js'
import {
  registerLocalService,
  unregisterLocalService,
  hasLocalService,
  getLocalServiceAccess
} from '../shared/local-state.js'

const logger = new Logger({ logGroup: 'yamf-sse-service' })

/**
 * Format a message as an SSE event string
 * @param {string} event - Event name
 * @param {*} data - Event data (will be JSON-stringified if not a string)
 * @param {string} [id] - Optional event ID for reconnection tracking
 * @returns {string} Formatted SSE message
 */
function formatSSE(event, data, id) {
  let message = ''
  if (id) message += `id: ${id}\n`
  if (event) message += `event: ${event}\n`
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  message += `data: ${payload}\n\n`
  return message
}

/**
 * Create a client handle object that wraps a response for SSE writing
 */
function createClientHandle(clientId, response, request, metadata = {}) {
  const client = {
    id: clientId,
    connectedAt: Date.now(),
    metadata,

    send(event, data, id) {
      if (response.writableEnded) return false
      response.write(formatSSE(event, data, id))
      return true
    },

    close() {
      if (!response.writableEnded) {
        response.end()
      }
    }
  }
  return client
}

/**
 * Create an SSE service for pushing real-time events to connected clients
 * 
 * @param {string} serviceName - Name of the SSE service
 * @param {Object} handlers - Event handlers
 * @param {Function} [handlers.onConnect] - Called when a client connects: (client, request) => void
 * @param {Function} [handlers.onDisconnect] - Called when a client disconnects: (clientId) => void
 * @param {Object} [handlers.channels] - Pubsub channels to subscribe to: { channelName: (data, clients) => void }
 * @param {Object} [options] - Configuration options
 * @param {string} [options.accessControl='public'] - Access control level ('private' or 'public')
 * @param {number} [options.heartbeatInterval=30000] - Heartbeat interval in ms (0 to disable)
 * @param {string} [options.useAuthService] - Auth service name for protected connections
 * @returns {Promise<Object>} SSE service instance
 * 
 * @example
 * const sse = await createEventSourceService('live-updates', {
 *   onConnect: async (client, request) => {
 *     client.send('connected', { message: 'Welcome' })
 *   },
 *   onDisconnect: async (clientId) => {
 *     console.log('Client left:', clientId)
 *   },
 *   channels: {
 *     'order.updated': (data, clients) => {
 *       clients.forEach(c => c.send('order-update', data))
 *     }
 *   }
 * }, { accessControl: 'public', useAuthService: 'auth-service' })
 * 
 * sse.broadcast('news', { headline: 'Something happened' })
 */
export default async function createEventSourceService(serviceName, handlers = {}, options = {}) {
  const { onConnect, onDisconnect, channels } = handlers
  const accessControl = options.accessControl || 'public'
  const heartbeatInterval = options.heartbeatInterval !== undefined ? options.heartbeatInterval : 30000
  
  if (accessControl === 'pure' || accessControl === 'local') {
    throw new Error(
      `SSE services require HTTP connections and cannot use "${accessControl}" access control. ` +
      `Use "private" or "public" instead.`
    )
  }

  if (hasLocalService(serviceName)) {
    const existingAccess = getLocalServiceAccess(serviceName)
    throw new Error(
      `Cannot create SSE service "${serviceName}". ` +
      `A ${existingAccess} service with this name already exists on this node.`
    )
  }

  // Client connection tracking
  const clients = new Map()

  // Service cache and context (for calling other services, pubsub, etc.)
  const cache = options.sharedCache || createServiceState()
  const context = buildEnhancedContext(cache, serviceName)
  context._sseClients = clients

  let pubSubManager = null
  let heartbeatTimer = null

  /**
   * HTTP handler for the SSE service
   * Detects SSE connections via Accept header and holds them open
   * Non-SSE requests get service info
   */
  async function sseServiceHandler(payload, request, response) {
    
    const accept = request.headers['accept'] || ''

    if (!accept.includes('text/event-stream')) {
      return {
        service: serviceName,
        type: 'sse-service',
        clients: clients.size,
        accessControl
      }
    }

    // SSE connection setup
    const clientId = crypto.randomBytes(8).toString('hex')

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    // node client request waits for first write before continuing to callback
    // send a start event to signal the connection is ready
    response.write(formatSSE('start'))

    // Disable socket timeout for this long-lived connection
    if (request.socket) request.socket.setTimeout(0)
    if (response.socket) response.socket.setTimeout(0)

    const client = createClientHandle(clientId, response, request, {
      userAgent: request.headers['user-agent'],
      lastEventId: request.headers['last-event-id'] || null
    })

    clients.set(clientId, { client, response, request })

    logger.debug(`SSE client connected: ${clientId} (total: ${clients.size})`)

    // Handle client disconnect
    request.on('close', () => {
      clients.delete(clientId)
      logger.debug(`SSE client disconnected: ${clientId} (total: ${clients.size})`)

      if (onDisconnect) {
        try { onDisconnect.call(context, clientId) } catch (err) {
          logger.debugErr(`onDisconnect error for ${clientId}:`, err)
        }
      }
    })

    if (onConnect) {
      try {
        await onConnect.call(context, client, request)
      } catch (err) {
        logger.debugErr(`onConnect error for ${clientId}:`, err)
      }
    }

    // Return false to signal http-server that we've taken control of the response
    return false
  }

  // Name the handler for better error stacks
  Object.defineProperty(sseServiceHandler, 'name', { value: serviceName, writable: false })

  const boundHandler = bindServiceFunction(sseServiceHandler, context)
  const shutdownTerminateRef = { terminate: null }
  const cacheHandler = createCacheAwareHandler(boundHandler, cache, context, { shutdownTerminateRef })
  Object.defineProperty(cacheHandler, 'name', { value: serviceName, writable: false })

  // Register in local state
  registerLocalService(serviceName, boundHandler, accessControl)

  // Create HTTP server and register with registry
  // SSE services use streamPayload (no body parsing for GET) and no request timeout
  let result
  try {
    result = await createAndRegisterService(serviceName, cacheHandler, {
      ...options,
      streamPayload: true,
      requestTimeout: 0,
      headersTimeout: 0,
      serviceType: 'sse',
      timeout: 0
    })
  } catch (err) {
    unregisterLocalService(serviceName)
    throw err
  }

  const { location, server, registryData } = result

  updateCache(cache, registryData)
  updateContext(context, cache)

  // Start heartbeat timer
  if (heartbeatInterval > 0) {
    heartbeatTimer = setInterval(() => {
      for (const [id, { client, response: res }] of clients) {
        if (res.writableEnded) {
          clients.delete(id)
          continue
        }
        res.write(': heartbeat\n\n')
      }
    }, heartbeatInterval)
    heartbeatTimer.unref()
  }

  // Subscribe to pubsub channels if configured
  if (channels && Object.keys(channels).length > 0) {
    pubSubManager = createPubSubManager(serviceName, location)
    context._pubSubManager = pubSubManager

    for (const [channel, handler] of Object.entries(channels)) {
      if (typeof handler !== 'function') {
        throw new Error(`Channel handler for "${channel}" must be a function`)
      }
      await pubSubManager.subscribe(channel, async (data) => {
        const clientHandles = Array.from(clients.values()).map(c => c.client)
        await handler.call(context, data, clientHandles)
      })
    }
  }

  logger.info(`SSE service "${serviceName}" running at ${location}`)

  // Build the service object
  server.name = serviceName
  server.service = serviceName
  server.location = location
  server.type = 'sse-service'
  server.accessControl = accessControl
  server.cache = cache
  server.context = context

  /**
   * Broadcast an event to all connected clients
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @param {string} [id] - Optional event ID
   * @returns {number} Number of clients that received the event
   */
  server.broadcast = function broadcast(event, data, id) {
    let sent = 0
    for (const [clientId, { client, response: res }] of clients) {
      if (res.writableEnded) {
        clients.delete(clientId)
        continue
      }
      client.send(event, data, id)
      sent++
    }
    return sent
  }

  /**
   * Get list of connected client handles
   * @returns {Array<Object>} Array of client handle objects
   */
  server.getClients = function getClients() {
    return Array.from(clients.values()).map(({ client }) => ({
      id: client.id,
      connectedAt: client.connectedAt,
      metadata: client.metadata
    }))
  }

  /**
   * Send an event to a specific client
   * @param {string} clientId - Client ID
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @returns {boolean} True if sent, false if client not found
   */
  server.sendTo = function sendTo(clientId, event, data, id) {
    const entry = clients.get(clientId)
    if (!entry || entry.response.writableEnded) {
      clients.delete(clientId)
      return false
    }
    return entry.client.send(event, data, id)
  }

  // Override terminate for graceful cleanup
  const httpServerTerminate = server.terminate.bind(server)
  const runSseShutdown = async () => {
    logger.debug(`Terminating SSE service: ${serviceName}`)

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    for (const [id, { client }] of clients) {
      client.close()
    }
    clients.clear()

    unregisterLocalService(serviceName)
    removeFromCache(cache, { service: serviceName, location })
    if (pubSubManager) {
      await pubSubManager.cleanup()
    }
    try {
      await unregisterServiceFromRegistry(serviceName, location)
    } catch (err) {
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET' && err.code !== 'ENOTFOUND') {
        throw err
      }
    }
    await httpServerTerminate()
    logger.info(`SSE service "${serviceName}" terminated`)
  }
  const unregisterFromLifecycle = lifecycle.registerTerminable(runSseShutdown, { priority: 10 })
  server.terminate = async () => {
    unregisterFromLifecycle()
    await runSseShutdown()
  }
  shutdownTerminateRef.terminate = () => server.terminate()

  return server
}
