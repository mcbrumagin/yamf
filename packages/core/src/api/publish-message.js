import httpRequest from '../http-primitives/http-request.js'
import { buildPublishHeaders, HEADERS } from '../shared/yamf-headers.js'
import envConfig from '../shared/env-config.js'
import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'
import { getLocalSubscriptionHandlers } from '../shared/local-state.js'

const logger = new Logger({ logGroup: 'yamf-api' })

/**
 * Publish a message to a pubsub channel via the registry
 * 
 * @param {string} channel - The channel name to publish to
 * @param {any} message - The message payload to send
 * @returns {Promise<{results: Array, errors: Array}>} Results and errors from all subscribers
 */
export default async function publishMessage (channel, message, { authToken = null } = {}) {
  let registryHost = process.env.YAMF_REGISTRY_URL
  if (!registryHost) throw new Error('Please define "YAMF_REGISTRY_URL" env variable')

  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')

  const headers = {
    ...buildPublishHeaders(channel, registryToken),
    ...(authToken && { [HEADERS.AUTH_TOKEN]: authToken })
  }

  const result = await httpRequest(registryHost, {
    body: message,
    headers
  })

  return result
}

export async function publishMessageWithCache(cache, channel, message) {
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  const results = []
  const errors = []

  logger.debug('publishMessageWithCache - channel:', channel)

  // First, deliver to any local (pure) subscriptions
  const localHandlers = getLocalSubscriptionHandlers(channel)
  if (localHandlers.size > 0) {
    logger.debug(`Delivering to ${localHandlers.size} local handler(s)`)
    for (const handler of localHandlers) {
      try {
        const result = await handler(message)
        results.push({ type: 'local', result })
      } catch (err) {
        errors.push({ type: 'local', error: err.message })
      }
    }
  }

  // Then, deliver to network subscriptions via cache
  // Support both Map and plain object for backwards compatibility
  const subscriptions = cache.subscriptions instanceof Map
    ? cache.subscriptions.get(channel)
    : cache.subscriptions?.[channel]

  if (subscriptions) {
    const locations = subscriptions instanceof Set
      ? Array.from(subscriptions)
      : (Array.isArray(subscriptions) ? subscriptions : [subscriptions])

    logger.debug(`Delivering to ${locations.length} network location(s)`)

    for (const location of locations) {
      try {
        const result = await httpRequest(location, {
          body: message,
          headers: buildPublishHeaders(channel, registryToken)
        })
        results.push({ type: 'network', location, result })
      } catch (err) {
        errors.push({ type: 'network', location, error: err.message })
      }
    }
  }

  // If no handlers found anywhere
  if (localHandlers.size === 0 && (!subscriptions || 
      (subscriptions instanceof Set ? subscriptions.size === 0 : 
       (Array.isArray(subscriptions) ? subscriptions.length === 0 : false)))) {
    logger.warn(`No subscribers found for channel "${channel}"`)
  }

  return { results, errors }
}
