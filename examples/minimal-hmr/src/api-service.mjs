/**
 * One public service and one gateway route. Edit and save while `yamf dev` runs
 * to rebuild/redeploy; Vite HMR updates the browser shell independently.
 */
import { createService, createRoute, Logger } from '@yamf/core'

const logger = new Logger({ logGroup: 'minimal-hmr' })

await createService(
  'minimal-api',
  async function minimalApi (payload) {
    if (payload && typeof payload === 'object' && payload.op === 'ping') {
      return { ok: 'HOLY CRAP YES', t: Date.now() }
    }
    return { ok: 'YES', service: 'minimal-api' }
  },
  { accessControl: 'public' }
)

await createRoute('/api/ping', 'minimal-api', 'application/json')
logger.info('minimal-api: route /api/ping → minimal-api')
