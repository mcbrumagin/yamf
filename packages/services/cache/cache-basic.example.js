/**
 * Cache service: set / get / del via `callService`.
 */
import { registryServer, callService } from '@yamf/core'
import createCacheService from '@yamf/services-cache'

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

await registryServer()
await createCacheService({ expireTime: 60_000 })

await callService('cache-service', { set: { k: { v: 1 } } })
const v = await callService('cache-service', { get: 'k' })
console.log('get k:', v)
await callService('cache-service', { del: 'k' })
const after = await callService('cache-service', { get: 'k' })
console.log('after del:', after)
