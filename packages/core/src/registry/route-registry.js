/**
 * Route Registry
 * Manages HTTP route registration and lookup
 */

import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-registry' })

/**
 * Register a direct route (exact path match)
 */
export function registerDirectRoute(state, { service, path, dataType = 'dynamic' }) {
  state.routes.set(path, { service, dataType })
  logger.debug(`route "${path}" registered for service "${service}"`)
}

/**
 * Register a controller route (prefix match with wildcard)
 */
export function registerControllerRoute(state, { service, path, dataType = 'dynamic' }) {
  const basePath = path.replace('*', '')
  state.controllerRoutes.set(basePath, { service, dataType })
  logger.debug(`route controller "${path}" registered for service "${service}"`)
}

/**
 * Register a route (auto-detects direct vs controller)
 */
export function registerRoute(state, { service, path, dataType = 'dynamic' }) {
  if (path.includes('*')) {
    registerControllerRoute(state, { service, path, dataType })
  } else {
    registerDirectRoute(state, { service, path, dataType })
  }
}

/**
 * Unregister a route by path
 */
export function unregisterRoute(state, { path }) {
  if (!path) throw new HttpError(400, 'Route path is required for unregistration')

  const basePath = path.replace('*', '')
  let removed = false

  if (state.routes.has(path)) {
    state.routes.delete(path)
    removed = true
    logger.debug(`route "${path}" unregistered`)
  }

  if (state.controllerRoutes.has(basePath)) {
    state.controllerRoutes.delete(basePath)
    removed = true
    logger.debug(`controller route "${path}" unregistered`)
  }

  if (!removed) {
    throw new HttpError(404, `Route "${path}" not found`)
  }

  return { success: true }
}

/**
 * Find a controller route that matches the URL prefix
 */
export function findControllerRoute(state, url) {
  // logger.debug('findControllerRoute', { url, controllerRoutes: Object.fromEntries(state.controllerRoutes) })
  for (const [basePath, routeInfo] of state.controllerRoutes) {
    // logger.debug('findControllerRoute', { basePath, routeInfo })
    const regex = new RegExp(`^${basePath}`, 'i')
    if (regex.test(url)) {
      return routeInfo
    }
  }
  return null
}

/**
 * Get all routes (for listing/debugging)
 */
export function getAllRoutes(state) {
  return {
    routes: Object.fromEntries(state.routes),
    controllerRoutes: Object.fromEntries(state.controllerRoutes)
  }
}

