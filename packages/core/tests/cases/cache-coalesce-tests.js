/**
 * Slice E: coalesced cache update pushes. Default YAMF_CACHE_COALESCE_MS is 0, so the coalesce path
 * is not exercised in most runs; this file keeps it from rotting.
 */
import { assert, sleep, terminateAfter, withEnv } from '@yamf/test'
import {
  registryServer,
  createService,
  parseCommandHeaders,
  COMMANDS
} from '../../src/index.js'

const REGISTRY_URL = 'http://127.0.0.1:14031'
const COALESCE_TOK = 'test-tok-coalesce'

/**
 * When coalescing is on, multiple rapid registrations should be delivered in at least one
 * bulk cache-update round-trip (carrying yamf-cache-window-id) to an existing subscriber,
 * not only legacy header-only calls.
 */
export async function testCacheCoalesceBulkPathWithDeployStorm() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: REGISTRY_URL,
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_REGISTRY_TOKEN: COALESCE_TOK,
      YAMF_CACHE_COALESCE_MS: '50',
      YAMF_CACHE_COALESCE_MAX_MS: '5000',
      YAMF_CACHE_BULK_MAX: '500'
    },
    async () => {
      const obs = { bulk: 0, legacy: 0 }
      await terminateAfter(
        () => registryServer(),
        async () => {
          const listener = await createService('coalesce-listener', () => ({}))
          listener.before(async (payload, request, _response) => {
            if (!request?.headers) return payload
            const h = parseCommandHeaders(request.headers)
            if (h.command === COMMANDS.CACHE_UPDATE) {
              if (h.cacheWindowId) obs.bulk += 1
              else obs.legacy += 1
            }
            return payload
          })
          return listener
        },
        async () => {
          await sleep(120)
          const storms = await Promise.all(
            [1, 2, 3, 4, 5].map((i) => createService(`coalesce-storm-${i}`, () => ({})))
          )
          await sleep(250)
          await assert(
            obs,
            (o) => o.bulk >= 1,
            (o) => o.legacy < 4
          )
          for (const s of storms) {
            if (s?.terminate) await s.terminate()
          }
        }
      )
    }
  )
}
