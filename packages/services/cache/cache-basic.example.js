import { registryServer, callService } from '@yamf/core'
import { assert, terminateAfter } from '@yamf/test'
import createCacheService from '@yamf/services-cache'

export const name = 'cache: set/get/del'

export default async function run () {
  await terminateAfter(
    () => registryServer(),
    () => createCacheService({ expireTime: 60_000 }),
    async () => {
      await callService('cache-service', { set: { k: { v: 1 } } })
      const v = await callService('cache-service', { get: 'k' })
      await assert(v && v.v === 1, x => x === true)
      await callService('cache-service', { del: 'k' })
      const after = await callService('cache-service', { get: 'k' })
      await assert(after === null, x => x === true)
    }
  )
}
