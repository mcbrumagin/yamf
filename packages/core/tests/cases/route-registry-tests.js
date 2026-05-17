/**
 * Pure tests for `registry/route-registry.js` (register / unregister / lookup).
 */
import { assert, assertErr } from '@yamf/test'
import HttpError from '../../src/http-primitives/http-error.js'
import {
  registerRoute,
  unregisterRoute,
  findControllerRoute,
  getAllRoutes
} from '../../src/registry/route-registry.js'

function emptyState () {
  return { routes: new Map(), controllerRoutes: new Map() }
}

export function testRegisterDirectAndController () {
  const state = emptyState()
  registerRoute(state, { service: 'a', path: '/api/x' })
  registerRoute(state, { service: 'b', path: '/api/y/*', dataType: 'application/json' })
  const all = getAllRoutes(state)
  assert(all.routes['/api/x'], (r) => r.service === 'a')
  assert(all.controllerRoutes['/api/y/'], (r) => r.service === 'b' && r.dataType === 'application/json')
}

export function testFindControllerRoutePrefixMatch () {
  const state = emptyState()
  registerRoute(state, { service: 'pages', path: '/app/*' })
  const hit = findControllerRoute(state, '/app/dashboard')
  assert(hit, (r) => r.service === 'pages')
  assert(findControllerRoute(state, '/other'), (r) => r == null)
}

export function testUnregisterRouteRequiresPath () {
  const state = emptyState()
  assertErr(
    () => unregisterRoute(state, { path: '' }),
    (e) => e instanceof HttpError && e.status === 400
  )
}

export function testUnregisterRouteUnknownPath404 () {
  const state = emptyState()
  assertErr(
    () => unregisterRoute(state, { path: '/nope' }),
    (e) => e instanceof HttpError && e.status === 404
  )
}

export function testUnregisterControllerByWildcardPath () {
  const state = emptyState()
  registerRoute(state, { service: 'c', path: '/z/*' })
  unregisterRoute(state, { path: '/z/*' })
  assert(getAllRoutes(state).controllerRoutes, (m) => Object.keys(m).length === 0)
}
