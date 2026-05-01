/**
 * Subscription service: a long-lived service whose handlers are bound to pub/sub channels at
 * startup (vs. an ad-hoc `subscribe()` call). Use this when the service exists primarily to
 * react to events; it has explicit lifecycle and shows up in registry discovery.
 *
 * Access control levels match {@link createService} (`'pure' | 'local' | 'private' | 'public'`).
 */

import Logger from '../utils/logger.js'
import { lifecycle } from '../shared/process-lifecycle.js'
import { createPubSubManager } from '../service/pubsub-manager.js'
import { createServiceState, updateCache, removeFromCache } from '../service/service-state.js'
import { buildEnhancedContext, updateContext, bindServiceFunction } from '../service/service-context.js'
import { createCacheAwareHandler } from '../service/cache-handler.js'
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

function validateChannelMap (channelMap) {
  if (!channelMap || typeof channelMap !== 'object' || Array.isArray(channelMap)) {
    throw new TypeError('createSubscriptionService: channelMap must be an object of { channel: handler }')
  }
  const channels = Object.keys(channelMap)
  if (channels.length === 0) {
    throw new Error('createSubscriptionService: channelMap must contain at least one channel')
  }
  for (const [channel, handler] of Object.entries(channelMap)) {
    if (typeof handler !== 'function') {
      throw new TypeError(`createSubscriptionService: handler for channel "${channel}" must be a function`)
    }
  }
  return channels
}

/**
 * Create a service that subscribes to one or more pub/sub channels at startup.
 *
 * @param {string} serviceName
 * @param {Record<string, Function>} channelMap - `{ 'channel-name': async (msg) => { … } }`.
 *   For a single channel just use `{ 'channel': handler }`.
 * @param {Object} [options]
 * @param {'pure'|'local'|'private'|'public'} [options.accessControl='private']
 * @returns {Promise<Object>} Service instance with `terminate()`. Pure services have `location: null`.
 *
 * @example
 * const sub = await createSubscriptionService('user-events', {
 *   'user.created': async (data) => sendWelcomeEmail(data.email),
 *   'user.deleted': async (data) => cleanupUserData(data.id)
 * })
 *
 * @example
 * // Pure local subscription (no HTTP server)
 * const localSub = await createSubscriptionService('audit-log', {
 *   'app.event': async (data) => console.log('Event:', data)
 * }, { accessControl: 'pure' })
 */
export default async function createSubscriptionService (serviceName, channelMap, options = {}) {
  if (typeof serviceName !== 'string' || !serviceName) {
    throw new TypeError('createSubscriptionService: serviceName must be a non-empty string')
  }
  if (typeof channelMap === 'string') {
    throw new TypeError(
      'createSubscriptionService: pass a channel map. Replace `(name, channel, handler)` with ' +
      "`(name, { [channel]: handler })`."
    )
  }
  const channels = validateChannelMap(channelMap)
  const accessControl = options.accessControl || 'private'

  logger.debug(`createSubscriptionService - ${serviceName} with ${channels.length} channels (accessControl: ${accessControl})`)

  if (accessControl === 'pure') {
    return createPureSubscriptionService(serviceName, channelMap, channels, options)
  }

  if (hasLocalService(serviceName)) {
    const existingAccess = getLocalServiceAccess(serviceName)
    throw new Error(
      `Cannot create subscription service "${serviceName}" with accessControl="${accessControl}". ` +
      `A ${existingAccess} service with this name already exists on this node.`
    )
  }

  // Cache + context so subscription services participate in cache-update pushes and can call peers.
  const cache = options.sharedCache || createServiceState()
  const context = buildEnhancedContext(cache, serviceName)

  // Non-pubsub / non-internal requests: respond with service info.
  const subscriptionInfoHandler = async function subscriptionInfoHandler () {
    return {
      service: serviceName,
      type: 'subscription-service',
      channels,
      subscriptionCount: channels.length,
      accessControl
    }
  }

  const shutdownTerminateRef = { terminate: null }
  const cacheHandler = createCacheAwareHandler(
    subscriptionInfoHandler,
    cache,
    context,
    { shutdownTerminateRef }
  )

  const { location, server, registryData } = await createAndRegisterService(serviceName, cacheHandler, options)

  updateCache(cache, registryData)
  updateContext(context, cache)

  const pubSubManager = createPubSubManager(serviceName, location)
  context._pubSubManager = pubSubManager

  registerLocalService(
    serviceName,
    async (message, channel) => pubSubManager.handleIncomingMessage(channel, message),
    accessControl
  )

  const subscriptionIds = {}
  for (const [channel, handler] of Object.entries(channelMap)) {
    logger.debug(`Subscribing to channel: ${channel}`)
    subscriptionIds[channel] = await pubSubManager.subscribe(channel, bindServiceFunction(handler, context))
  }

  logger.info(`Subscription service "${serviceName}" running at ${location}`)
  logger.info(`Subscribed to ${channels.length} channels: ${channels.join(', ')}`)

  server.name = serviceName
  server.location = location
  server.service = serviceName
  server.type = 'subscription-service'
  server.channels = channels
  server.subscriptionIds = subscriptionIds
  server.accessControl = accessControl
  server.cache = cache
  server.context = context

  const httpServerTerminate = server.terminate.bind(server)
  const runSubShutdown = async () => {
    logger.debug(`Terminating subscription service: ${serviceName}`)
    unregisterLocalService(serviceName)
    await httpServerTerminate()
    removeFromCache(cache, { service: serviceName, location })
    await pubSubManager.cleanup()
    try {
      await unregisterServiceFromRegistry(serviceName, location)
    } catch (err) {
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET' && err.code !== 'ENOTFOUND') {
        throw err
      }
    }
    logger.info(`Subscription service "${serviceName}" terminated`)
  }
  // Late-bound: lifecycle invokes whatever `server.terminate` resolves to at shutdown time
  // so wrapper-added cleanup (e.g. `clearInterval`) is honored.
  let unregisterFromLifecycle
  server.terminate = async () => {
    unregisterFromLifecycle?.()
    await runSubShutdown()
  }
  unregisterFromLifecycle = lifecycle.registerTerminable(
    () => server.terminate(),
    { priority: 10 }
  )
  shutdownTerminateRef.terminate = () => server.terminate()

  return server
}

/**
 * Pure subscription service: only receives messages from within the same node process.
 */
async function createPureSubscriptionService (serviceName, channelMap, channels, options) {
  if (hasLocalService(serviceName)) {
    const existingAccess = getLocalServiceAccess(serviceName)
    throw new Error(
      `Cannot create pure subscription service "${serviceName}". ` +
      `A ${existingAccess} service with this name already exists on this node.`
    )
  }

  const handler = async (message, channel) => {
    const channelHandler = channelMap[channel]
    if (!channelHandler) {
      logger.warn(`No handler for channel "${channel}" in pure subscription service "${serviceName}"`)
      return { error: `No handler for channel "${channel}"` }
    }
    return await channelHandler(message)
  }

  registerLocalService(serviceName, handler, 'pure')

  for (const [channel, channelHandler] of Object.entries(channelMap)) {
    registerLocalSubscription(channel, channelHandler)
    logger.debug(`Pure subscription registered for channel: ${channel}`)
  }

  // notifyRegistryOfPureService never throws; returns null when no registry URL is set.
  await notifyRegistryOfPureService(serviceName, options)

  logger.info(`Pure subscription service "${serviceName}" registered (no HTTP server)`)
  logger.info(`Subscribed to ${channels.length} channels: ${channels.join(', ')}`)

  return {
    name: serviceName,
    service: serviceName,
    type: 'subscription-service',
    location: null,
    channels,
    accessControl: 'pure',

    async terminate () {
      for (const [channel, channelHandler] of Object.entries(channelMap)) {
        unregisterLocalSubscription(channel, channelHandler)
      }
      unregisterLocalService(serviceName)
      logger.info(`Pure subscription service "${serviceName}" terminated`)
    }
  }
}
