/**
 * Service Batch Creation
 * Optimized creation of multiple services with shared cache
 */

import { createServiceState } from './service-state.js'
import { getRegistryHost } from './service-validator.js'

/**
 * Validate that every batch entry is a named function with a unique name.
 * Returns the resolved service names in input order.
 */
export function validateServiceBatch (fns) {
  const names = new Set()
  const ordered = []

  for (const fn of fns) {
    if (typeof fn !== 'function') {
      throw new Error('All arguments to createServices must be functions')
    }
    if (!fn.name) {
      throw new Error(
        'All createServices functions must be named. Use: `async function serviceName () { … }` ' +
        'or call createService(name, fn) per service for explicit names.'
      )
    }
    if (names.has(fn.name)) {
      throw new Error(`Duplicate service name: ${fn.name}`)
    }
    names.add(fn.name)
    ordered.push(fn.name)
  }

  return ordered
}

/** Shared cache for a batch of services started together. */
export function createSharedCache () {
  return createServiceState()
}

/**
 * Create multiple services concurrently with a shared cache.
 *
 * - Validates all entries upfront (no half-started batches).
 * - Resolves the registry host once, fails fast if missing.
 * - Each service is created via `createServiceFn(name, fn, { ...options, sharedCache })`.
 * - After every service has registered, contexts are re-bound so peers can call each other
 *   via `this.<serviceName>()`.
 */
export async function createServiceBatch (fns, createServiceFn, options = {}) {
  const serviceNames = validateServiceBatch(fns)
  // Fail fast if YAMF_REGISTRY_URL is missing — same error every individual createService would
  // hit, surfaced before we kick off any work.
  getRegistryHost()
  const sharedCache = createSharedCache()

  const servers = await Promise.all(
    fns.map((fn, i) => createServiceFn(serviceNames[i], fn, { ...options, sharedCache }))
  )

  if (servers.length > 0) {
    const { updateContext } = await import('./service-context.js')
    for (const server of servers) {
      if (server.context && server.cache) {
        updateContext(server.context, server.cache)
      }
    }
  }

  return servers
}

