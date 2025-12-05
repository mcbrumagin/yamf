/**
 * Pub/Sub Manager
 * Handles publish-subscribe messaging between services
 */

import httpRequest from '../http-primitives/http-request.js'
import HttpError from '../http-primitives/http-error.js'
import { buildPublishHeaders, buildCacheUpdateHeaders, buildRegistryUpdatedHeaders } from '../shared/yamf-headers.js'
import envConfig from '../shared/env-config.js'

import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-registry' })

/**
 * Publish a message to all subscribers of a type
 */
export async function publish(state, { type, message }) {
  const results = []
  const errors = []
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  const subscribers = state.subscriptions.get(type)
  if (!subscribers) {
    return { results, errors }
  }
  
  for (const location of subscribers) {
    try {
      const result = await httpRequest(location, {
        body: message,
        headers: buildPublishHeaders(type, registryToken)
      })
      results.push(result)
    } catch (err) {
      errors.push(err)
    }
  }
  
  return { results, errors }
}

/**
 * Notify gateway that registry has been updated
 * Gateway will then pull the full state from registry (pull model for security)
 */
export async function notifyGatewayOfUpdate(state, { service, location }) {
  const gatewayUrl = envConfig.get('YAMF_GATEWAY_URL')
  if (!gatewayUrl) {
    // No separate gateway - registry is acting as gateway in dev mode
    return { notified: false, reason: 'no_gateway' }
  }
  
  // Check if gateway is pull-only
  const gatewayMetadata = state.serviceMetadata?.get('yamf-gateway')
  if (!gatewayMetadata?.pullOnly) {
    // Gateway is not configured as pull-only, skip notification
    return { notified: false, reason: 'not_pull_only' }
  }
  
  try {
    const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
    await httpRequest(gatewayUrl, {
      body: { service, location, timestamp: Date.now() },
      headers: buildRegistryUpdatedHeaders(registryToken)
    })
    logger.debug(`notifyGatewayOfUpdate - notified gateway about ${service}`)
    return { notified: true }
  } catch (err) {
    logger.debugErr(`Failed to notify gateway about update:`, err)
    // Don't fail the registration if gateway notification fails
    return { notified: false, error: err.message }
  }
}

/**
 * Publish cache update notifications to all subscribers
 * Uses yamf headers to identify internal cache update calls
 * Also notifies gateway via pull model
 */
export async function publishCacheUpdate(state, { subscription, service, location }) {
  const results = []
  const errors = []
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  // Notify gateway separately (pull model)
  const gatewayNotification = await notifyGatewayOfUpdate(state, { subscription, service, location })
  if (gatewayNotification.notified) {
    logger.debug('Gateway notified of registry update')
  }
  
  const subscribers = state.subscriptions.get('register')
  if (!subscribers) {
    return { results, errors, gatewayNotification }
  }
  
  // Notify regular services (push model)
  for (const subscriberLocation of subscribers) {
    try {
      const result = await httpRequest(subscriberLocation, {
        body: null, // No body needed - all info is in headers
        headers: buildCacheUpdateHeaders(subscription, service, location, registryToken)
      })
      results.push(result)
    } catch (err) {
      errors.push(err)
    }
  }
  
  return { results, errors, gatewayNotification }
}

/**
 * Subscribe a location to a message type
 */
export async function subscribe(state, { type, service, location }) {
  if (!state.subscriptions.has(type)) {
    state.subscriptions.set(type, new Set())
  }
  
  state.subscriptions.get(type).add(location)

  await publishCacheUpdate(state, { subscription: type, service, location })
  logger.debug('subscribe - location:', location, 'type:', type)
}

/**
 * Unsubscribe a location from a message type
 */
export function unsubscribe(state, { type, location }) {
  const subscribers = state.subscriptions.get(type)
  
  if (!subscribers) {
    throw new HttpError(404, `No type "${type}"`)
  }
  
  const removed = subscribers.delete(location)
  if (!removed) {
    throw new HttpError(404, `No location "${location}" for type "${type}"`)
  }
  
  // Clean up empty subscription types
  if (subscribers.size === 0) {
    state.subscriptions.delete(type)
  }

  // TODO update remove - await publishCacheUpdate(state, { subscription: type, location })
  logger.debug('unsubscribe - location:', location, 'type:', type)
}

/**
 * Remove all subscriptions for a specific location
 * Useful during service unregistration
 */
export function removeAllSubscriptionsForLocation(state, location) {
  for (const [type, subscribers] of state.subscriptions) {
    subscribers.delete(location)
    if (subscribers.size === 0) {
      state.subscriptions.delete(type)
    }
  }
}

