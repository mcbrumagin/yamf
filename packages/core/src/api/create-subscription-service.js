/**
 * Create Subscription Service
 * Dedicated service for handling event subscriptions
 * Automatically subscribes to all channels on startup and registers with registry
 * 
 * This is the recommended way to handle event subscriptions - subscription services
 * are clearly long-running and have explicit lifecycle management.
 * 
 * Access Control Levels:
 * - 'pure': No HTTP server, direct local subscriptions only (same node process)
 * - 'local': HTTP server but only receives messages from same node
 * - 'private': HTTP server, receives messages from any service (default)
 * - 'public': HTTP server, can receive messages via gateway
 */

import Logger from '../utils/logger.js'
import { COMMANDS, parseCommandHeaders } from '../shared/yamf-headers.js'
import { createPubSubManager } from '../service/pubsub-manager.js'
import {
  createAndRegisterService,
  unregisterServiceFromRegistry,
  notifyRegistryOfPureService
} from './service-helpers.js'
import {
  registerLocalService,
  unregisterLocalService,
  hasLocalService,
  getLocalServiceAccess,
  registerLocalSubscription,
  unregisterLocalSubscription
} from '../shared/local-state.js'

const logger = new Logger({ logGroup: 'yamf-subscription-service' })

/**
 * Create a subscription service to handle event channels
 * 
 * Unlike regular services that handle RPC calls, subscription services are dedicated
 * to processing events from specific channels. They automatically subscribe on startup
 * and properly clean up on termination.
 * 
 * @param {string} serviceName - Name of the subscription service
 * @param {string|Object} channelOrMap - Channel name (string) or map of channel names to handlers (object)
 * @param {Function|Object} handlerOrOptions - Handler function (if channelOrMap is string) or options (if channelOrMap is object)
 * @param {Object} [options] - Configuration options (only used when channelOrMap is string)
 * @param {string} [options.accessControl='private'] - Access control level
 * @returns {Promise<Object>} Service instance with terminate() method
 * 
 * @example
 * // Single channel subscription
 * const service = await createSubscriptionService('user-created-handler', 'user.created', 
 *   async (userData) => {
 *     await sendWelcomeEmail(userData.email)
 *     return { welcomed: true }
 *   }
 * )
 * 
 * @example
 * // Multiple channels with channel map
 * const service = await createSubscriptionService('user-event-handler', {
 *   'user.created': async (userData) => {
 *     await sendWelcomeEmail(userData.email)
 *     return { welcomed: true }
 *   },
 *   'user.deleted': async (userData) => {
 *     await cleanupUserData(userData.id)
 *   }
 * })
 * 
 * @example
 * // Pure local subscription (no HTTP server, same node only)
 * const service = await createSubscriptionService('local-logger', {
 *   'app.event': async (data) => console.log('Event:', data)
 * }, { accessControl: 'pure' })
 * 
 * @example
 * // Multi-domain event aggregator
 * const logger = await createSubscriptionService('event-logger', {
 *   'user.created': async (data) => logEvent('user', 'created', data),
 *   'user.updated': async (data) => logEvent('user', 'updated', data),
 *   'order.placed': async (data) => logEvent('order', 'placed', data)
 * })
 * 
 * // Later: await service.terminate()
 */
export default async function createSubscriptionService(serviceName, channelOrMap, handlerOrOptions, options) {
  let channelMap
  
  // Support both single channel/handler and channel map
  // TODO support an array of channels that map to the same handler
  if (typeof channelOrMap === 'string') {
    // Single channel mode: createSubscriptionService(name, channel, handler, options)
    const channel = channelOrMap
    const handler = handlerOrOptions
    
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function')
    }
    
    channelMap = { [channel]: handler }
    // options is already the 4th parameter
  } else if (typeof channelOrMap === 'object') {
    // Channel map mode: createSubscriptionService(name, channelMap, options)
    channelMap = channelOrMap
    options = handlerOrOptions || {}
    
    // Validate channelMap
    if (!channelMap || typeof channelMap !== 'object') {
      throw new Error('channelMap must be an object with channel names as keys')
    }
    
    const channels = Object.keys(channelMap)
    if (channels.length === 0) {
      throw new Error('channelMap must contain at least one channel')
    }
    
    // Validate all handlers are functions
    for (const [channel, handler] of Object.entries(channelMap)) {
      if (typeof handler !== 'function') {
        throw new Error(`Handler for channel "${channel}" must be a function`)
      }
    }
  } else {
    // TODO update for array support
    throw new Error('Second parameter must be a channel name (string) or channel map (object)')
  }
  
  options = options || {}
  const channels = Object.keys(channelMap)
  const accessControl = options.accessControl || 'private'
  
  logger.debug(`createSubscriptionService - ${serviceName} with ${channels.length} channels (accessControl: ${accessControl})`)
  
  // Handle pure subscription services (no HTTP server)
  if (accessControl === 'pure') {
    return createPureSubscriptionService(serviceName, channelMap, channels, options)
  }
  
  // Check for local service name collision
  if (hasLocalService(serviceName)) {
    const existingAccess = getLocalServiceAccess(serviceName)
    throw new Error(
      `Cannot create subscription service "${serviceName}" with accessControl="${accessControl}". ` +
      `A ${existingAccess} service with this name already exists on this node.`
    )
  }
  
  // We need to declare pubSubManager in outer scope so it's accessible in handler
  let pubSubManager = null
  
  // Setup service infrastructure (allocate port, create server, register)
  const { location, server, registryData } = await createAndRegisterService(
    serviceName,
    async function subscriptionServiceHandler(message, request, response) {
      const { command, pubsubChannel } = parseCommandHeaders(request.headers)
      
      // Handle incoming subscription messages
      if (command === COMMANDS.PUBSUB_PUBLISH) {
        if (!pubSubManager) {
          logger.debugErr(`PubSub manager not initialized for ${serviceName}`)
          return { results: [], errors: [{ error: 'PubSub manager not ready' }] }
        }
        return await pubSubManager.handleIncomingMessage(pubsubChannel, message)
      }
      
      // For non-pubsub requests, return service info
      return {
        service: serviceName,
        type: 'subscription-service',
        channels: Object.keys(channelMap),
        subscriptionCount: channels.length,
        accessControl
      }
    },
    options
  )
  
  // Register in local state for direct calls
  registerLocalService(serviceName, async (message, channel) => {
    if (pubSubManager) {
      return await pubSubManager.handleIncomingMessage(channel, message)
    }
    return { error: 'PubSub manager not ready' }
  }, accessControl)
  
  // Create pubsub manager for routing messages to handlers
  pubSubManager = createPubSubManager(serviceName, location)
  
  // Subscribe to all channels upfront
  const subscriptionIds = {}
  for (const [channel, handler] of Object.entries(channelMap)) {
    logger.debug(`Subscribing to channel: ${channel}`)
    subscriptionIds[channel] = await pubSubManager.subscribe(channel, handler)
  }
  
  logger.info(`Subscription service "${serviceName}" running at ${location}`)
  logger.info(`Subscribed to ${channels.length} channels: ${channels.join(', ')}`)
  
  // Add metadata to server instance
  server.name = serviceName
  server.location = location
  server.service = serviceName
  server.type = 'subscription-service'
  server.channels = channels
  server.subscriptionIds = subscriptionIds
  server.accessControl = accessControl
  
  // Override terminate to handle cleanup
  const httpServerTerminate = server.terminate.bind(server)
  server.terminate = async () => {
    logger.debug(`Terminating subscription service: ${serviceName}`)
    
    // Cleanup local registration
    unregisterLocalService(serviceName)
    
    // Cleanup subscriptions first (unsubscribes from all channels)
    await pubSubManager.cleanup()
    
    // Unregister from registry
    await unregisterServiceFromRegistry(serviceName, location)
    
    // Stop HTTP server
    await httpServerTerminate()
    
    logger.info(`Subscription service "${serviceName}" terminated`)
  }
  
  return server
}

/**
 * Create a pure subscription service (no HTTP server)
 * Pure subscription services only receive messages from within the same node process
 * 
 * @param {string} serviceName - Service name
 * @param {Object} channelMap - Map of channels to handlers
 * @param {Array} channels - List of channel names
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Minimal service object
 */
async function createPureSubscriptionService(serviceName, channelMap, channels, options) {
  // Check for existing local service
  if (hasLocalService(serviceName)) {
    const existingAccess = getLocalServiceAccess(serviceName)
    throw new Error(
      `Cannot create pure subscription service "${serviceName}". ` +
      `A ${existingAccess} service with this name already exists on this node.`
    )
  }
  
  // Create handler function that routes to appropriate channel handler
  const handler = async (message, channel) => {
    const channelHandler = channelMap[channel]
    if (!channelHandler) {
      logger.warn(`No handler for channel "${channel}" in pure subscription service "${serviceName}"`)
      return { error: `No handler for channel "${channel}"` }
    }
    return await channelHandler(message)
  }
  
  // Register in local state
  registerLocalService(serviceName, handler, 'pure')
  
  // Register local subscriptions for each channel
  for (const [channel, channelHandler] of Object.entries(channelMap)) {
    registerLocalSubscription(channel, channelHandler)
    logger.debug(`Pure subscription registered for channel: ${channel}`)
  }
  
  // Notify registry for observability
  try {
    await notifyRegistryOfPureService(serviceName, options)
  } catch (err) {
    logger.warn(`Failed to notify registry of pure subscription service "${serviceName}":`, err.message)
  }
  
  logger.info(`Pure subscription service "${serviceName}" registered (no HTTP server)`)
  logger.info(`Subscribed to ${channels.length} channels: ${channels.join(', ')}`)
  
  // Return minimal service object
  const pureService = {
    name: serviceName,
    service: serviceName,
    type: 'subscription-service',
    location: null,
    channels,
    accessControl: 'pure',
    
    /**
     * Terminate the pure subscription service
     */
    terminate: async () => {
      // Unregister local subscriptions
      for (const [channel, channelHandler] of Object.entries(channelMap)) {
        unregisterLocalSubscription(channel, channelHandler)
      }
      
      // Unregister local service
      unregisterLocalService(serviceName)
      
      logger.info(`Pure subscription service "${serviceName}" terminated`)
    }
  }
  
  return pureService
}

