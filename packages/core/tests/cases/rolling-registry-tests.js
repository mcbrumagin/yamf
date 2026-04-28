import { assert, assertErr, terminateAfter, sleep } from '@yamf/test'
import { subscribeToEventSource } from '@yamf/client/event-source'
import {
  registryServer,
  createService,
  createSubscriptionService,
  createEventSourceService,
  publishMessage,
  httpRequest,
  HEADERS,
  COMMANDS,
  buildSetupHeaders
} from '../../src/index.js'

/** Shared in this file: avoid broadcast noise and speed up teardown. */
const registryOpts = { broadcastShutdownOnTerminate: false }

/**
 * process.once is centralized; only SIGINT/SIGTERM from lifecycle, not N× services.
 */
export async function testProcessLifecycle_CentralizedSignalHandlers() {
  await terminateAfter(
    () => registryServer(registryOpts),
    () => Promise.all(
      Array.from({ length: 10 }, (_, i) => createService(`svc-sig-${i}`, () => ({ i })))
    ),
    async () => {
      const n = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT')
      await assert(n, (s) => s <= 4)
    }
  )
}

export async function testDrainingRegistryReturns503OnSetup() {
  await terminateAfter(
    () => registryServer(registryOpts),
    async (reg) => {
      const url = process.env.YAMF_REGISTRY_URL
      const token = process.env.YAMF_REGISTRY_TOKEN
      const other = '00000000-0000-4000-8000-000000000001'
      if (other === reg._state.registryInstanceId) {
        throw new Error('REGISTRY instance id collided with test constant — change other uuid')
      }
      await httpRequest(url, {
        method: 'POST',
        body: {},
        headers: {
          'content-type': 'application/json',
          [HEADERS.COMMAND]: COMMANDS.REGISTRY_DRAIN,
          [HEADERS.REGISTRY_INSTANCE_ID]: other,
          [HEADERS.REGISTRY_TOKEN]: token
        }
      })
      await assertErr(
        () =>
          httpRequest(url, {
            headers: {
              ...buildSetupHeaders('late-svc', 'http://127.0.0.1:1', token)
            }
          }),
        (e) => e.status === 503
      )
    }
  )
}

export async function testRegistryDrainSelfIdReturns400() {
  await terminateAfter(
    () => registryServer(registryOpts),
    async (reg) => {
      const id = reg._state.registryInstanceId
      const url = process.env.YAMF_REGISTRY_URL
      const token = process.env.YAMF_REGISTRY_TOKEN
      await assertErr(
        () =>
          httpRequest(url, {
            method: 'POST',
            body: {},
            headers: {
              'content-type': 'application/json',
              [HEADERS.COMMAND]: COMMANDS.REGISTRY_DRAIN,
              [HEADERS.REGISTRY_INSTANCE_ID]: id,
              [HEADERS.REGISTRY_TOKEN]: token
            }
          }),
        (e) => e.status === 400
      )
    }
  )
}

export async function testServiceShutdownCommandRejectsInvalidToken() {
  await terminateAfter(
    () => registryServer(registryOpts),
    () => createService('sd-svc', () => ({})),
    async (reg, serv) => {
      const res = await fetch(serv.location, {
        method: 'POST',
        body: '{}',
        headers: {
          'content-type': 'application/json',
          [HEADERS.COMMAND]: COMMANDS.SERVICE_SHUTDOWN,
          [HEADERS.REGISTRY_TOKEN]: 'wrong-token',
          [HEADERS.SERVICE_NAME]: 'sd-svc',
          [HEADERS.SERVICE_LOCATION]: serv.location
        }
      })
      await assert(res.status, (s) => s === 401)
    }
  )
}

export async function testCallStillWorksWhenDraining() {
  await terminateAfter(
    () => registryServer(registryOpts),
    () => createService('call-svc', (p) => ({ echo: p })),
    async (reg) => {
      const url = process.env.YAMF_REGISTRY_URL
      const token = process.env.YAMF_REGISTRY_TOKEN
      const other = '00000000-0000-4000-8000-000000000002'
      if (other === reg._state.registryInstanceId) {
        throw new Error('REGISTRY id collision in test')
      }
      await httpRequest(url, {
        method: 'POST',
        body: {},
        headers: {
          'content-type': 'application/json',
          [HEADERS.COMMAND]: COMMANDS.REGISTRY_DRAIN,
          [HEADERS.REGISTRY_INSTANCE_ID]: other,
          [HEADERS.REGISTRY_TOKEN]: token
        }
      })
      const r = await httpRequest(url, {
        body: { x: 1 },
        headers: {
          'content-type': 'application/json',
          [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
          [HEADERS.SERVICE_NAME]: 'call-svc'
        }
      })
      await assert(r, (x) => x.echo.x === 1)
    }
  )
}

export async function testRegistryHealthShowsDraining() {
  await terminateAfter(
    () => registryServer(registryOpts),
    async (reg) => {
      const url = process.env.YAMF_REGISTRY_URL
      const token = process.env.YAMF_REGISTRY_TOKEN
      const other = '00000000-0000-4000-8000-000000000003'
      if (other === reg._state.registryInstanceId) {
        throw new Error('REGISTRY id collision in test')
      }
      const h0 = await httpRequest(url, { headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH } })
      await assert(h0, (h) => h.draining === false)
      await httpRequest(url, {
        method: 'POST',
        body: {},
        headers: {
          'content-type': 'application/json',
          [HEADERS.COMMAND]: COMMANDS.REGISTRY_DRAIN,
          [HEADERS.REGISTRY_INSTANCE_ID]: other,
          [HEADERS.REGISTRY_TOKEN]: token
        }
      })
      const h1 = await httpRequest(url, { headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH } })
      await assert(h1, (h) => h.draining === true)
    }
  )
}

/**
 * Subscription channel handler runs with `this === context` and can this.call a peer
 * registered after the subscription service (cache-aware).
 */
export async function testSubscriptionChannelHandlerBindsThisContextLatePeer() {
  await terminateAfter(
    () => registryServer(registryOpts),
    () =>
      createSubscriptionService('sub-slice2-late', {
        'foo:bar:slice2': async function () {
          return await this.call('late-peer-s2', { n: 11 })
        }
      }),
    () => createService('late-peer-s2', (p) => ({ ok: p.n })),
    async () => {
      const out = await publishMessage('foo:bar:slice2', {})
      await assert(
        out,
        (r) => r.results?.[0]?.results?.[0]?.ok === 11
      )
    }
  )
}

/**
 * SSE onConnect runs with `this === context` and can this.call a peer registered after
 * the SSE service starts.
 */
export async function testSseOnConnectBindsThisContextLatePeer() {
  await terminateAfter(
    () => registryServer(registryOpts),
    () =>
      createEventSourceService(
        'sse-slice2-late',
        {
          onConnect: async function (client) {
            const r = await this.call('late-sse-s2', { n: 7 })
            client.send('late', r)
          }
        },
        { accessControl: 'private' }
      ),
    () => createService('late-sse-s2', (p) => ({ value: p.n })),
    async (reg, sse) => {
      const events = []
      const es = await subscribeToEventSource(sse.location, (ev) => events.push(ev))
      await sleep(150)
      await assert(
        events,
        (e) => e.length >= 2,
        (e) => e.some((x) => x?.event === 'late' && x?.data?.value === 7)
      )
      es.close()
    }
  )
}
