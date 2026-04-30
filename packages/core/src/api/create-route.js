import http from 'node:http'
import httpRequest from '../http-primitives/http-request.js'
import createService from './create-service.js'
import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'
import envConfig from '../shared/env-config.js'
import { buildRouteRegisterHeaders, buildLookupHeaders } from '../shared/yamf-headers.js'

const logger = new Logger({ logGroup: 'yamf-api' })

const falseOnFailure = async (fn) => {
  try { return await fn() } catch { return false }
}

/**
 * Derive a stable service name from a route path: `/api/users/*` → `route-api-users`.
 * Used as a fallback when the handler function passed to `createRoute` is anonymous.
 */
function routeNameFromPath (path) {
  const slug = String(path)
    .replace(/\*/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug ? `route-${slug}` : `route-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Register an HTTP route on the registry that proxies to a service.
 *
 * `dataType` is positional (matches the URL → handler → content-type mental model). If you
 * pass a function for the second argument it must be a **named** function — its `.name` is
 * used as the service name. Internally this calls {@link createService} when the named
 * service isn't already registered.
 *
 * @param {string} path - URL path to expose on the registry (e.g. `/api/users`).
 * @param {string|Function|http.Server} serviceNameOrFn -
 *   - `string`: name of an already-registered service to route to.
 *   - `Function`: named function — implicitly creates a service with that name and routes to it.
 *   - `http.Server` (from a previous `createService(...)`): use this server directly.
 * @param {string} [dataType='application/json'] - Route response content-type hint.
 * @returns {Promise<http.Server|undefined>} The created service when a function was passed.
 */
export default async function createRoute (path, serviceNameOrFn, dataType) {
  if (!path || !serviceNameOrFn) {
    throw new HttpError(400, 'Route path and service fn or name are required')
  }

  const registryHost = envConfig.getRequired('YAMF_REGISTRY_URL')
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
  let serviceName
  let server

  if (serviceNameOrFn instanceof http.Server) {
    server = serviceNameOrFn
    serviceName = server.name
  } else if (typeof serviceNameOrFn === 'function') {
    // Prefer the function's name; fall back to a deterministic name derived from `path`
    // so that anonymous handlers (`createRoute('/x', () => …)`) still get a useful
    // service-name and aren't fighting the new "explicit name" rule for createService.
    const candidateName = serviceNameOrFn.name || routeNameFromPath(path)

    const existingLocation = await falseOnFailure(() => httpRequest(registryHost, {
      headers: { 'mute-internal-error': true, ...buildLookupHeaders(candidateName) }
    }))

    if (existingLocation) {
      serviceName = candidateName
      logger.debug('createRoute - using existing service:', serviceName)
    } else {
      server = await createService(candidateName, serviceNameOrFn)
      serviceName = server.name
      logger.debug('createRoute - created new service:', serviceName)
    }
  } else {
    serviceName = serviceNameOrFn
  }

  await httpRequest(registryHost, {
    headers: buildRouteRegisterHeaders(serviceName, path, dataType, 'route', registryToken)
  })

  logger.info(`Route "${path}" → service "${serviceName}"`)
  return server
}

/**
 * Register multiple routes in path-iteration order.
 * @param {Record<string, string|Function|http.Server>} routeMap
 * @param {string} [dataType]
 */
export async function createRoutes (routeMap, dataType) {
  const routes = []
  for (const path in routeMap) {
    routes.push(await createRoute(path, routeMap[path], dataType))
  }
  return routes
}
