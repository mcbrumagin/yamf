/**
 * @yamf/services-dev-hmr `service.js` — env gates (no listening) + registry/pubsub + SSE.
 */
import { assert, terminateAfter, sleep, withEnv } from '@yamf/test'
import { registryServer, publishMessage, CHANNELS } from '@yamf/core'
import { subscribeToEventSource } from '@yamf/client/event-source'
import createDevHmrService from '../service.js'

const TEST_SERVICE = 'yamf-dev-hmr-integration'

/**
 * `YAMF_DEV` not `on` → no service (fast, no registry).
 */
export async function testCreateYamfDevHmrServiceSkipsWhenYamfDevOff () {
  const prev = process.env.YAMF_DEV
  const prevNode = process.env.NODE_ENV
  process.env.YAMF_DEV = ''
  process.env.NODE_ENV = 'test'
  try {
    const s = await createDevHmrService()
    await assert(s, (v) => v == null)
  } finally {
    if (prev !== undefined) process.env.YAMF_DEV = prev
    else delete process.env.YAMF_DEV
    if (prevNode !== undefined) process.env.NODE_ENV = prevNode
    else delete process.env.NODE_ENV
  }
}

export async function testCreateYamfDevHmrServiceSkipsWhenNodeEnvProduction () {
  await withEnv(
    { YAMF_DEV: 'on', NODE_ENV: 'production' },
    async () => {
      const s = await createDevHmrService({ serviceName: TEST_SERVICE })
      await assert(s, (v) => v == null)
    }
  )
}

/**
 * One SSE client, publish on `yamf:dev-reload` → `reload` with payload; onConnect sends `ready`.
 */
export async function testYamfDevHmrPubsubForwardsReloadToClients () {
  await withEnv(
    { YAMF_DEV: 'on', NODE_ENV: 'test' },
    async () =>
      terminateAfter(
        () => registryServer(),
        () => createDevHmrService({ serviceName: TEST_SERVICE, accessControl: 'public' }),
        async (registry, service) => {
          await assert(
            service,
            (s) => s != null,
            (s) => typeof s?.location === 'string',
            (s) => typeof s?.terminate === 'function'
          )
          const events = []
          const es = await subscribeToEventSource(service.location, (e) => events.push(e))
          await sleep(250)

          await publishMessage(CHANNELS.DEV_RELOAD, {
            service: 'my-app',
            hash: 'deadbeef',
            at: 12345,
            source: 'test'
          })
          await sleep(400)

          await assert(
            events,
            (evs) => evs.some((ev) => ev.event === 'ready' && ev.data?.ok === true),
            (evs) =>
              evs.some(
                (ev) =>
                  ev.event === 'reload' &&
                  ev.data?.service === 'my-app' &&
                  ev.data?.hash === 'deadbeef' &&
                  ev.data?.at === 12345 &&
                  ev.data?.source === 'test'
              )
          )
          es.close?.()
        }
      )
  )
}
