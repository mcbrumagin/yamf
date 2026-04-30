/**
 * Failure-path coverage for `api/call-service.js#callServiceWithCache`. These are the branches
 * a service hits when its cache (replicated registry view) disagrees with reality — service
 * missing, service marked external (pure/local on another node), or registered with no live
 * locations.
 */
import { assert, assertErr, terminateAfter } from '@yamf/test'
import { registryServer, createService } from '../../src/index.js'
import { callServiceWithCache } from '../../src/api/call-service.js'

export async function testCallServiceWithCacheUnknownServiceThrows404 () {
  await terminateAfter(async () => {
    await registryServer()
    const svc = await createService('caller', () => 'ok')

    await assertErr(
      async () => callServiceWithCache(svc.cache, 'no-such-service', {}),
      err => err.status === 404,
      err => err.message.includes('No service by name "no-such-service"')
    )
  })
}

export async function testCallServiceWithCacheExternalServiceThrows403 () {
  await terminateAfter(async () => {
    await registryServer()
    const svc = await createService('caller', () => 'ok')

    // Simulate the "service exists on another node as pure/local" view: a single location
    // with `external` access-control. callServiceWithCache must refuse without going over
    // the wire.
    svc.cache.services.set('remote-pure', new Set(['http://other-node:1']))
    svc.cache.serviceAccess.set('remote-pure', 'external')

    await assertErr(
      async () => callServiceWithCache(svc.cache, 'remote-pure', {}),
      err => err.status === 403,
      err => err.message.includes('pure/local service on another node'),
      err => err.message.includes("'private'")
    )
  })
}

export async function testCallServiceWithCacheNoLocationsThrows404 () {
  await terminateAfter(async () => {
    await registryServer()
    const svc = await createService('caller', () => 'ok')

    // Service is in the cache but the location set is empty (e.g. last replica drained).
    svc.cache.services.set('drained', new Set())

    await assertErr(
      async () => callServiceWithCache(svc.cache, 'drained', {}),
      err => err.status === 404,
      err => err.message.includes('No locations for service "drained"')
    )
  })
}

export async function testCallServiceWithCacheShortCircuitsToLocal () {
  await terminateAfter(async () => {
    await registryServer()
    const echo = await createService('echo', (p) => ({ echoed: p }))

    // callServiceWithCache uses the local registry (same-process services bypass HTTP).
    const result = await callServiceWithCache(echo.cache, 'echo', { hello: 'world' })

    assert(result,
      r => r && typeof r === 'object',
      r => r.echoed?.hello === 'world'
    )
  })
}
