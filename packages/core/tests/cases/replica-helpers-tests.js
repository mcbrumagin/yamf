/**
 * Pure-state tests for `registry/replica-helpers.js`. These exercise the read-only helpers
 * the registry uses when answering replica/lookup queries — no servers required.
 */
import { assert } from '@yamf/test'
import { getReplicasFor, listServiceLocations } from '../../src/registry/replica-helpers.js'

function buildState (entries = {}) {
  const services = new Map()
  const replicaMetadata = new Map()
  for (const [name, replicas] of Object.entries(entries)) {
    services.set(name, new Set(replicas.map(r => r.location)))
    for (const r of replicas) {
      if (r.metadata) replicaMetadata.set(`${name}\0${r.location}`, r.metadata)
    }
  }
  return { services, replicaMetadata }
}

export function testGetReplicasForUnknownService () {
  const state = buildState()
  assert(getReplicasFor(state, 'missing'),
    r => Array.isArray(r),
    r => r.length === 0
  )
}

export function testGetReplicasForMergesMetadata () {
  const state = buildState({
    auth: [
      { location: 'http://a:1', metadata: { sourceHash: 'h1', nodeId: 'n1' } },
      { location: 'http://b:2', metadata: { configVersion: 'v2' } }
    ]
  })

  assert(getReplicasFor(state, 'auth'),
    r => r.length === 2,
    r => r.find(x => x.location === 'http://a:1')?.sourceHash === 'h1',
    r => r.find(x => x.location === 'http://a:1')?.nodeId === 'n1',
    r => r.find(x => x.location === 'http://b:2')?.configVersion === 'v2',
    // location is preserved alongside spread metadata fields:
    r => r.every(x => typeof x.location === 'string' && x.location.startsWith('http://'))
  )
}

export function testGetReplicasForLocationWithoutMetadata () {
  const state = buildState({ user: [{ location: 'http://x:9' }] })
  assert(getReplicasFor(state, 'user'),
    r => r.length === 1,
    r => r[0].location === 'http://x:9',
    r => r[0].sourceHash === undefined,
    r => r[0].configVersion === undefined
  )
}

export function testListServiceLocationsUnknown () {
  const state = buildState()
  assert(listServiceLocations(state, 'missing'),
    r => Array.isArray(r),
    r => r.length === 0
  )
}

export function testListServiceLocationsReturnsAll () {
  const state = buildState({ cache: [{ location: 'http://a:1' }, { location: 'http://b:2' }] })
  assert(listServiceLocations(state, 'cache'),
    r => r.length === 2,
    r => r.includes('http://a:1'),
    r => r.includes('http://b:2')
  )
}
