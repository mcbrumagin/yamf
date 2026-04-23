/**
 * Pub/Sub Manager
 * Handles publish-subscribe messaging between services
 */

import httpRequest from '../http-primitives/http-request.js'
import HttpError from '../http-primitives/http-error.js'
import { buildPublishHeaders, buildCacheUpdateHeaders, buildRegistryUpdatedHeaders, buildBulkCacheUpdateHeaders } from '../shared/yamf-headers.js'
import envConfig from '../shared/env-config.js'

import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-registry' })

// Default 0: preserve synchronous push (tests + backward compat). Set e.g. 50 in prod to batch.
const COALESCE_MS = () => Number(envConfig.get('YAMF_CACHE_COALESCE_MS', 0))
const COALESCE_MAX_MS = () => Number(envConfig.get('YAMF_CACHE_COALESCE_MAX_MS', 250))
const BULK_MAX = () => Number(envConfig.get('YAMF_CACHE_BULK_MAX', 500))
const STALE_AFTER = () => Number(envConfig.get('YAMF_CACHE_PUSH_STALE_AFTER', 3))

function isCoalescingEnabled() {
  return COALESCE_MS() > 0
}

function getCoalesceKey(state) {
  const id = state.registryInstanceId || 'reg'
  state.cacheUpdateSeq = (state.cacheUpdateSeq || 0) + 1
  return `${id}:${state.cacheUpdateSeq}`
}

function wantsBulkCache(state, subscriberLocation) {
  const name = state.addresses?.get(subscriberLocation)
  if (!name) return false
  return state.serviceMetadata.get(name)?.cacheBulk === true
}

function getOrCreatePending(state, location) {
  if (!state.cacheCoalesceBySubscriber) {
    state.cacheCoalesceBySubscriber = new Map()
  }
  let p = state.cacheCoalesceBySubscriber.get(location)
  if (!p) {
    p = { items: [], firstAt: null, debounceTimer: null, maxTimer: null }
    state.cacheCoalesceBySubscriber.set(location, p)
  }
  return p
}

function clearTimers(p) {
  if (p?.debounceTimer) {
    clearTimeout(p.debounceTimer)
    p.debounceTimer = null
  }
  if (p?.maxTimer) {
    clearTimeout(p.maxTimer)
    p.maxTimer = null
  }
}

/**
 * Send one batch of cache updates to a subscriber. `mode` `bulk` = one JSON body; `legacy` = N header-only calls.
 */
async function sendCacheUpdatesToSubscriber(state, registryToken, subscriberLocation, items, mode) {
  if (items.length === 0) return { ok: true }
  if (mode === 'bulk') {
    const windowId = getCoalesceKey(state)
    const body = { windowId, updates: items }
    await httpRequest(subscriberLocation, {
      body,
      headers: buildBulkCacheUpdateHeaders(windowId, registryToken)
    })
    return { ok: true }
  }
  for (const u of items) {
    await httpRequest(subscriberLocation, {
      body: null,
      headers: buildCacheUpdateHeaders(
        u.subscription,
        u.service,
        u.location,
        registryToken,
        u.contract != null ? u.contract : null
      )
    })
  }
  return { ok: true }
}

async function pushWithRetry(state, registryToken, subscriberLocation, items, mode) {
  const failures = state.cachePushFailures
  const stale = state.cacheUpdateStaleSubscribers
  if (stale.has(subscriberLocation)) {
    return { dropped: 'stale' }
  }
  try {
    await sendCacheUpdatesToSubscriber(state, registryToken, subscriberLocation, items, mode)
    failures.delete(subscriberLocation)
    stale.delete(subscriberLocation)
    return { ok: true }
  } catch (err) {
    logger.debugErr(`cache coalesce push failed for ${subscriberLocation}, retrying once:`, err?.message)
    try {
      await new Promise((r) => setImmediate(r))
      await sendCacheUpdatesToSubscriber(state, registryToken, subscriberLocation, items, mode)
      failures.delete(subscriberLocation)
      stale.delete(subscriberLocation)
      return { ok: true }
    } catch (err2) {
      const n = (failures.get(subscriberLocation) || 0) + 1
      failures.set(subscriberLocation, n)
      if (n >= STALE_AFTER()) {
        stale.add(subscriberLocation)
        logger.warn(`marking cache subscriber stale after ${n} failed windows: ${subscriberLocation}`)
      }
      throw err2
    }
  }
}

async function flushSubscriberQueue(state, registryToken, subscriberLocation) {
  const p = state.cacheCoalesceBySubscriber?.get(subscriberLocation)
  if (!p || p.items.length === 0) return
  const items = p.items.splice(0, p.items.length)
  p.firstAt = null
  clearTimers(p)
  const mode = wantsBulkCache(state, subscriberLocation) ? 'bulk' : 'legacy'
  try {
    await pushWithRetry(state, registryToken, subscriberLocation, items, mode)
  } catch (err) {
    logger.debugErr('flushSubscriberQueue final failure', subscriberLocation, err?.message)
  }
}

function enqueueCacheUpdate(state, { subscription, service, location, contract }) {
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  const subscribers = state.subscriptions.get('register')
  if (!subscribers) {
    return
  }
  const item = { subscription, service, location, contract }
  for (const subscriberLocation of subscribers) {
    if (state.cacheUpdateStaleSubscribers?.has(subscriberLocation)) {
      continue
    }
    const p = getOrCreatePending(state, subscriberLocation)
    const wasEmpty = p.items.length === 0
    p.items.push(item)
    if (p.items.length >= BULK_MAX()) {
      const chunk = p.items.splice(0, p.items.length)
      p.firstAt = null
      clearTimers(p)
      const mode = wantsBulkCache(state, subscriberLocation) ? 'bulk' : 'legacy'
      void pushWithRetry(state, registryToken, subscriberLocation, chunk, mode).catch((err) =>
        logger.debugErr('immediate bulk-max flush failed', err?.message)
      )
      continue
    }
    if (wasEmpty) {
      p.firstAt = Date.now()
      p.maxTimer = setTimeout(() => {
        void flushSubscriberQueue(state, registryToken, subscriberLocation)
      }, COALESCE_MAX_MS())
    }
    if (p.debounceTimer) clearTimeout(p.debounceTimer)
    p.debounceTimer = setTimeout(() => {
      void flushSubscriberQueue(state, registryToken, subscriberLocation)
    }, COALESCE_MS())
  }
}

/**
 * Await all pending coalesced cache flushes (registry shutdown, slice E)
 */
export async function drainCacheUpdateQueues(state) {
  if (!state?.cacheCoalesceBySubscriber) return
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  const jobs = []
  for (const loc of state.cacheCoalesceBySubscriber.keys()) {
    const p = state.cacheCoalesceBySubscriber.get(loc)
    if (p && p.items.length > 0) {
      clearTimers(p)
      const items = p.items
      p.items = []
      p.firstAt = null
      if (state.cacheUpdateStaleSubscribers?.has(loc)) {
        continue
      }
      const mode = wantsBulkCache(state, loc) ? 'bulk' : 'legacy'
      jobs.push(
        pushWithRetry(state, registryToken, loc, items, mode).catch((err) =>
          logger.debugErr('drainCacheUpdateQueues', loc, err?.message)
        )
      )
    } else if (p) {
      clearTimers(p)
    }
  }
  await Promise.all(jobs)
  state.cacheCoalesceBySubscriber.clear()
}

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
 * Original per-subscriber push (used when coalescing is off).
 */
async function publishCacheUpdateImmediate(state, { subscription, service, location, contract }) {
  const results = []
  const errors = []
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  const gatewayNotification = await notifyGatewayOfUpdate(state, { subscription, service, location })
  if (gatewayNotification.notified) {
    logger.debug('Gateway notified of registry update')
  }
  const subscribers = state.subscriptions.get('register')
  if (!subscribers) {
    return { results, errors, gatewayNotification }
  }
  const one = { subscription, service, location, contract }
  for (const subscriberLocation of subscribers) {
    if (state.cacheUpdateStaleSubscribers?.has(subscriberLocation)) {
      continue
    }
    const mode = wantsBulkCache(state, subscriberLocation) ? 'bulk' : 'legacy'
    try {
      const result = await sendCacheUpdatesToSubscriber(
        state,
        registryToken,
        subscriberLocation,
        [one],
        mode
      )
      results.push(result)
    } catch (err) {
      errors.push(err)
    }
  }
  return { results, errors, gatewayNotification }
}

/**
 * Publish cache update notifications to all subscribers (coalesced when enabled, slice E)
 */
export async function publishCacheUpdate(state, { subscription, service, location, contract }) {
  if (!isCoalescingEnabled()) {
    return publishCacheUpdateImmediate(state, { subscription, service, location, contract })
  }
  const results = []
  const errors = []
  const gatewayNotification = await notifyGatewayOfUpdate(state, { subscription, service, location })
  if (gatewayNotification.notified) {
    logger.debug('Gateway notified of registry update')
  }
  enqueueCacheUpdate(state, { subscription, service, location, contract })
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
  if (state.cacheCoalesceBySubscriber) {
    const p = state.cacheCoalesceBySubscriber.get(location)
    if (p) {
      if (p.debounceTimer) clearTimeout(p.debounceTimer)
      if (p.maxTimer) clearTimeout(p.maxTimer)
    }
    state.cacheCoalesceBySubscriber.delete(location)
  }
  state.cachePushFailures?.delete(location)
  state.cacheUpdateStaleSubscribers?.delete(location)
}
