/**
 * Route Registry
 * Manages HTTP route registration and lookup
 */

import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-gateway' })

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

