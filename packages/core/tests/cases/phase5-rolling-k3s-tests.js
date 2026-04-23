import { assert, assertErr, terminateAfter, withEnv } from '@yamf/test'
import {
  registryServer,
  createService,
  httpRequest,
  HEADERS,
  COMMANDS,
  buildSetupHeaders
} from '../../src/index.js'

/**
 * process.once is centralized; only SIGINT/SIGTERM from lifecycle, not N× services.
 */
export async function testProcessLifecycle_CentralizedSignalHandlers() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4005',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_REGISTRY_TOKEN: 'test-tok-rolling'
    },
    async () => {
      await terminateAfter(
        () => registryServer(4005, { broadcastShutdownOnTerminate: false }),
        () => Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            createService(`svc-sig-${i}`, () => ({ i }))
          )
        ),
        async () => {
          const n = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT')
          await assert(n, (s) => s <= 4)
        }
      )
    }
  )
}

export async function testDrainingRegistryReturns503OnSetup() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4006',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_GATEWAY_URL: 'http://127.0.0.1:5006',
      YAMF_REGISTRY_TOKEN: 'test-tok-rolling-2'
    },
    async () => {
      await terminateAfter(
        () => registryServer(4006, { broadcastShutdownOnTerminate: false }),
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
  )
}

export async function testRegistryDrainSelfIdReturns400() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4010',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_GATEWAY_URL: 'http://127.0.0.1:5010',
      YAMF_REGISTRY_TOKEN: 'test-tok-rself'
    },
    async () => {
      await terminateAfter(
        () => registryServer(4010, { broadcastShutdownOnTerminate: false }),
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
  )
}

export async function testServiceShutdownCommandRejectsInvalidToken() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4007',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_REGISTRY_TOKEN: 'test-tok-sd'
    },
    async () => {
      await terminateAfter(
        () => registryServer(4007, { broadcastShutdownOnTerminate: false }),
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
  )
}

export async function testCallStillWorksWhenDraining() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4008',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_GATEWAY_URL: 'http://127.0.0.1:5008',
      YAMF_REGISTRY_TOKEN: 'test-tok-rolling-3'
    },
    async () => {
      await terminateAfter(
        () => registryServer(4008, { broadcastShutdownOnTerminate: false }),
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
  )
}

export async function testRegistryHealthShowsDraining() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4009',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_GATEWAY_URL: 'http://127.0.0.1:5009',
      YAMF_REGISTRY_TOKEN: 'test-tok-h'
    },
    async () => {
      await terminateAfter(
        () => registryServer(4009, { broadcastShutdownOnTerminate: false }),
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
  )
}
