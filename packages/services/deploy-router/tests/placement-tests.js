import { assert, assertErr } from '@yamf/test'
import { pickNode } from '../placement.js'

export async function testPickNode503WhenNoHealthyLocations () {
  await assertErr(
    () => pickNode({ listHealthyLocations: () => [] }, 'pm3'),
    (e) => e.status === 503 && (e.message || '').includes('no-placement')
  )
}

export async function testPickNode503WhenAllExcluded () {
  await assertErr(
    () =>
      pickNode(
        { listHealthyLocations: () => ['http://a:1', 'http://b:2'] },
        'pm3',
        { excludeNodes: ['http://a:1', 'http://b:2'] }
      ),
    (e) => e.status === 503
  )
}

export async function testPickNodeReturnsSoleNodeWithoutReplicaMetadata () {
  const n = pickNode(
    {
      listHealthyLocations: () => ['http://node:1'],
      _state: {}
    },
    'pm3'
  )
  await assert(n, (x) => x === 'http://node:1')
}

/**
 * C4: nodes with load tallies; least-loaded node wins. Here b:2 has 1 replica, a:1 has 2.
 */
export async function testPickNodeChoosesLeastLoadedFromReplicaMetadata () {
  const registry = {
    listHealthyLocations: () => ['http://a:1', 'http://b:2'],
    _state: {
      replicaMetadata: new Map([
        ['r1', { nodeId: 'http://a:1' }],
        ['r2', { nodeId: 'http://a:1' }],
        ['r3', { nodeId: 'http://b:2' }]
      ])
    }
  }
  const n = pickNode(registry, 'pm3')
  await assert(n, (x) => x === 'http://b:2')
}

export async function testPickNodeRespectsExcludeNodes () {
  const registry = {
    listHealthyLocations: () => ['http://a:1', 'http://b:2', 'http://c:3'],
    _state: { replicaMetadata: new Map() }
  }
  const n = pickNode(registry, 'pm3', { excludeNodes: ['http://a:1', 'http://c:3'] })
  await assert(n, (x) => x === 'http://b:2')
}
