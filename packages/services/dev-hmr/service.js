/**
 * @yamf/services-dev-hmr — SSE service that subscribes to `CHANNELS.DEV_RELOAD` and
 * sends a `reload` event to all browser EventSource clients (ROADMAP Phase 4 D2).
 *
 * Start only in dev: requires `YAMF_DEV=on` and `NODE_ENV !== 'production'`.
 */

import { createEventSourceService, CHANNELS, Logger } from '@yamf/core'

const logger = new Logger({ logGroup: 'yamf-dev-hmr' })
const DEFAULT_SERVICE = 'yamf-dev'

/**
 * @param {object} [options]
 * @param {string} [options.serviceName='yamf-dev'] — registry / lookup name
 * @param {'public' | 'private'} [options.accessControl='public'] — external browsers need public or a gateway
 * @returns {Promise<object|null>} SSE server, or `null` when dev-hmr is disabled
 */
export default async function createDevHmrService (options = {}) {
  if (process.env.YAMF_DEV !== 'on' || process.env.NODE_ENV === 'production') {
    logger.info('yamf dev-hmr skipped (set YAMF_DEV=on and non-production to enable)')
    return null
  }

  const { serviceName = DEFAULT_SERVICE, accessControl = 'public' } = options

  const server = await createEventSourceService(
    serviceName,
    {
      onConnect: (client) => {
        client.send('ready', { ok: true })
      },
      channels: {
        [CHANNELS.DEV_RELOAD]: async (data, clientHandles) => {
          const payload = {
            service: data?.service,
            hash: data?.hash,
            at: data?.at,
            source: data?.source
          }
          let sent = 0
          for (const h of clientHandles) {
            if (h.send('reload', payload)) sent++
          }
          return { sent }
        }
      }
    },
    { accessControl, heartbeatInterval: 30000 }
  )

  logger.info(`@yamf/services-dev-hmr "${serviceName}" at ${server.location} (subscribed to ${CHANNELS.DEV_RELOAD})`)
  return server
}
