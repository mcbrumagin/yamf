import { assert } from '@yamf/test'
import { computeBundleHash } from '../lib/bundle-hash.js'

export async function testBundleHashIsDeterministic () {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const a = computeBundleHash(bytes, {
    entry: 'src/svc.js',
    env: ['A', 'B'],
    deps: { 'a.js': 'sha256-aa' },
    nodeTarget: 'node20',
    builderVersion: '0.0.0'
  })
  const b = computeBundleHash(Buffer.from([1, 2, 3, 4]), {
    entry: 'src/svc.js',
    env: ['B', 'A'],
    deps: { 'a.js': 'sha256-aa' },
    nodeTarget: 'node20',
    builderVersion: '0.0.0'
  })
  await assert(a, (h) => h === b && h.startsWith('sha256-'))
}
