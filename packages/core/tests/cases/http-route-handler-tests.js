/**
 * Registry vs gateway `resolvePossibleRoute` — trailing slash redirect, local debug payload, prod 404.
 */
import { assert, assertErr, withEnv } from '@yamf/test'
import { resolvePossibleRoute as resolveRegistryRoute } from '../../src/registry/http-route-handler.js'
import { resolvePossibleRoute as resolveGatewayRoute } from '../../src/gateway/http-route-handler.js'
import HttpError from '../../src/http-primitives/http-error.js'
import envConfig from '../../src/shared/env-config.js'

function emptyRouteState () {
  return { routes: new Map(), controllerRoutes: new Map() }
}

export async function testTrailingSlashRedirect301 () {
  const state = emptyRouteState()
  const calls = []
  const response = {
    isEnded: false,
    writeHead (code, headers) {
      calls.push({ code, headers })
    },
    end () {
      this.isEnded = true
    }
  }
  const out = await resolveRegistryRoute(state, { url: '/foo' }, response, null)
  await assert(out, (r) => r === false)
  await assert(calls, (c) => c.length === 1 && c[0].code === 301 && c[0].headers.Location === '/foo/')

  const callsG = []
  const responseG = {
    isEnded: false,
    writeHead (code, headers) {
      callsG.push({ code, headers })
    },
    end () {
      this.isEnded = true
    }
  }
  const outG = await resolveGatewayRoute(emptyRouteState(), { url: '/bar' }, responseG, null)
  await assert(outG, (r) => r === false)
  await assert(callsG, (c) => c.length === 1 && c[0].code === 301 && c[0].headers.Location === '/bar/')
}

export async function testNoMatchLocalReturnsRouteMapPayload () {
  await withEnv({ ENVIRONMENT: 'local' }, async function noMatchLocal () {
    envConfig.reloadFromProcessEnv()
    const state = emptyRouteState()
    const response = { isEnded: false, writeHead () {}, end () {} }
    for (const resolve of [resolveRegistryRoute, resolveGatewayRoute]) {
      const r = await resolve(state, { url: '/unknown/' }, response, null)
      await assert(
        r,
        (x) => x && x.dataType === 'application/json',
        (x) => x.payload && typeof x.payload === 'object'
      )
    }
  })
}

export async function testNoMatchProductionThrows404 () {
  await withEnv({ ENVIRONMENT: 'production' }, async function noMatchProd () {
    envConfig.reloadFromProcessEnv()
    const state = emptyRouteState()
    const response = { isEnded: false, writeHead () {}, end () {} }
    for (const resolve of [resolveRegistryRoute, resolveGatewayRoute]) {
      await assertErr(
        async () => resolve(state, { url: '/missing/' }, response, null),
        (e) => e instanceof HttpError && e.status === 404
      )
    }
  })
}
