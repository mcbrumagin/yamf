import { assert } from '@yamf/test'
import createYamfDevHmrService from '../service.js'

/**
 * dev-hmr is a no-op unless YAMF_DEV=on and not production; avoid starting servers in test.
 */
export async function testCreateYamfDevHmrServiceSkipsWhenYamfDevOff () {
  const prev = process.env.YAMF_DEV
  const prevNode = process.env.NODE_ENV
  process.env.YAMF_DEV = ''
  process.env.NODE_ENV = 'test'
  try {
    const s = await createYamfDevHmrService()
    await assert(s, (v) => v == null)
  } finally {
    if (prev !== undefined) process.env.YAMF_DEV = prev
    else delete process.env.YAMF_DEV
    if (prevNode !== undefined) process.env.NODE_ENV = prevNode
    else delete process.env.NODE_ENV
  }
}
