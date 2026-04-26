/**
 * D4: createYamfDevHmrSpaPatch — default preserve only for source vite.
 */
import { assert } from '@yamf/test'
import { createYamfDevHmrSpaPatch } from '../src/dev-hmr.js'

export async function testYamfDevHmrSpaPatchViteRerender () {
  let calls = 0
  const patch = createYamfDevHmrSpaPatch({
    onRerender: () => { calls++ }
  })
  await assert(patch({ source: 'vite', at: 1 }), (r) => r === false)
  await assert(calls, (n) => n === 1)
  await assert(patch({ source: 'yamf-dev', service: 'auth', hash: 'h' }), (r) => r === undefined)
  await assert(calls, (n) => n === 1)
}

export async function testYamfDevHmrSpaPatchCustomPreserve () {
  const custom = createYamfDevHmrSpaPatch({
    onRerender: () => {},
    preserveWhen: (d) => d?.source === 'custom'
  })
  await assert(custom({ source: 'custom' }), (r) => r === false)
  await assert(custom({ source: 'vite' }), (r) => r === undefined)
}
