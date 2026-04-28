/**
 * Gateway-Specific Tests
 * Tests for the API gateway functionality including:
 * - Pull-only security model
 * - Registry synchronization
 * - Service routing
 * - Health checks
 *
 * Env: rely on packages/core/.env.test (YAMF_REGISTRY_URL, YAMF_GATEWAY_URL, YAMF_REGISTRY_TOKEN).
 * Use withEnv only when a test must diverge from defaults (e.g. missing YAMF_REGISTRY_URL).
 */

import {
  assert,
  assertErr,
  sleep,
  terminateAfter,
  withEnv
} from '@yamf/test'

import {
  registryServer,
  gatewayServer,
  createService,
  createRoute,
  httpRequest,
  HEADERS,
  COMMANDS,
  buildRegistryPullHeaders,
  buildRegistryUpdatedHeaders,
  buildGatewayPullHeaders
} from '../../src/index.js'

const GATEWAY_URL = process.env.YAMF_GATEWAY_URL
const REGISTRY_URL = process.env.YAMF_REGISTRY_URL
const REGISTRY_TOKEN = process.env.YAMF_REGISTRY_TOKEN

/**
 * Test 1: Gateway health check
 */
export async function testGatewayHealthCheck() {
  await terminateAfter(
    () => gatewayServer(),
    async () => {
      const response = await httpRequest(GATEWAY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      })

      assert(response,
        r => r.status === 'ready',
        r => typeof r.timestamp === 'number'
      )
    }
  )
}

/**
 * Test 2: Gateway pre-registration
 */
export async function testGatewayPreRegistration() {
  await terminateAfter(
    () => registryServer(),
    async () => {
      await sleep(100) // Give registry time to pre-register gateway

      const gatewayLocation = await httpRequest(REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
          [HEADERS.SERVICE_NAME]: 'yamf-gateway',
          [HEADERS.REGISTRY_TOKEN]: REGISTRY_TOKEN
        }
      })

      assert(gatewayLocation,
        loc => loc === GATEWAY_URL
      )
    }
  )
}

/**
 * Test 3: Gateway pulls registry state
 */
export async function testGatewayPullsState() {
  await terminateAfter(
    () => registryServer(),
    () => gatewayServer(),
    async () => {
      const testServiceUrl = 'http://localhost:16000'
      await httpRequest(REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_REGISTER,
          [HEADERS.SERVICE_NAME]: 'test-service',
          [HEADERS.SERVICE_LOCATION]: testServiceUrl,
          [HEADERS.REGISTRY_TOKEN]: REGISTRY_TOKEN
        }
      })

      await sleep(100) // Give time for async notification

      const registryState = await httpRequest(REGISTRY_URL, {
        headers: buildRegistryPullHeaders(REGISTRY_TOKEN)
      })

      assert(registryState,
        s => s.services !== undefined,
        s => s.services['test-service'] !== undefined,
        s => Array.isArray(s.services['test-service']),
        s => s.services['test-service'].includes(testServiceUrl),
        s => typeof s.timestamp === 'number'
      )
    }
  )
}

/**
 * Test 4: Gateway receives update notifications
 */
export async function testGatewayUpdateNotification() {
  await terminateAfter(
    () => registryServer(),
    () => gatewayServer(),
    async () => {
      await sleep(100)

      const response = await httpRequest(GATEWAY_URL, {
        body: { service: 'test-service', location: 'http://localhost:16000' },
        headers: buildRegistryUpdatedHeaders(REGISTRY_TOKEN)
      })

      assert(response,
        r => r.status === 'updated',
        r => typeof r.servicesCount === 'number',
        r => typeof r.routesCount === 'number',
        r => typeof r.timestamp === 'number'
      )
    }
  )
}

/**
 * Test 5: Gateway rejects updates without token
 */
export async function testGatewayRejectsUnauthorizedUpdates() {
  await terminateAfter(
    () => gatewayServer(),
    async () => {
      await sleep(50)

      await assertErr(
        async () => httpRequest(GATEWAY_URL, {
          body: { service: 'malicious-service', location: 'http://evil.com' },
          headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_UPDATED }
        }),
        err => err.message.includes('403') || err.message.includes('token')
      )
    }
  )
}

/**
 * Test 6: Gateway is not subscribed to push events
 */
export async function testGatewayIsNotSubscribed() {
  await terminateAfter(
    () => registryServer(),
    () => gatewayServer(),
    () => createService('normal-service', () => {
      return { received: 'cache-update' }
    }),
    async () => {
      await sleep(100)

      await httpRequest(REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_REGISTER,
          [HEADERS.SERVICE_NAME]: 'another-service',
          [HEADERS.SERVICE_LOCATION]: 'http://localhost:16001',
          [HEADERS.REGISTRY_TOKEN]: REGISTRY_TOKEN
        }
      })

      await sleep(100)

      const registryState = await httpRequest(REGISTRY_URL, {
        headers: buildRegistryPullHeaders(REGISTRY_TOKEN)
      })

      const gatewayMetadata = registryState.serviceMetadata?.['yamf-gateway']

      assert(gatewayMetadata,
        m => m !== undefined,
        m => m.pullOnly === true,
        m => m.public === true,
        m => m.type === 'gateway'
      )
    }
  )
}

/**
 * Test 7: Gateway routes to services
 */
export async function testGatewayRoutesToServices() {
  await terminateAfter(
    () => registryServer(),
    () => createService('echo-service', payload => {
      return { echo: payload }
    }),
    () => createRoute('/api/echo', 'echo-service'),
    () => gatewayServer(),
    async () => {
      await sleep(100) // Give time for gateway to do initial pull

      const response = await httpRequest(`${GATEWAY_URL}/api/echo`, {
        method: 'POST',
        body: { message: 'hello' }
      })

      assert(response,
        r => r.echo !== undefined,
        r => r.echo.message === 'hello'
      )
    }
  )
}

/**
 * Test 8: Gateway metadata is stored correctly
 */
export async function testGatewayMetadataStorage() {
  await terminateAfter(
    () => registryServer(),
    async () => {
      await sleep(100)

      const state = await httpRequest(REGISTRY_URL, {
        headers: buildRegistryPullHeaders(REGISTRY_TOKEN)
      })

      const gatewayMetadata = state.serviceMetadata?.['yamf-gateway']

      assert(gatewayMetadata,
        m => m !== undefined,
        m => m.pullOnly === true,
        m => m.public === true,
        m => m.preregistered === true,
        m => m.type === 'gateway',
        m => typeof m.registeredAt === 'number'
      )
    }
  )
}

/**
 * Test 9: Gateway state reflects registry updates
 * Tests that gateway properly pulls and maintains registry state
 */
export async function testGatewayStateReflectsRegistry() {
  await terminateAfter(
    () => registryServer(),
    () => createService('test-service', () => ({ test: true })),
    () => gatewayServer(),
    async () => {
      await sleep(100)

      await httpRequest(REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.ROUTE_REGISTER,
          [HEADERS.SERVICE_NAME]: 'test-service',
          [HEADERS.ROUTE_PATH]: '/api/test',
          [HEADERS.REGISTRY_TOKEN]: REGISTRY_TOKEN
        }
      })

      await sleep(100) // Give gateway time to pull

      const gatewayState = await httpRequest(GATEWAY_URL, {
        headers: buildGatewayPullHeaders(REGISTRY_TOKEN)
      })

      assert(gatewayState,
        s => s.services !== undefined,
        s => s.routes !== undefined,
        s => s.controllerRoutes !== undefined,
        s => s.serviceAuth !== undefined,
        s => typeof s.timestamp === 'number',
        s => s.services['test-service'] !== undefined,
        s => s.routes['/api/test'] !== undefined
      )
    }
  )
}

/**
 * Test 10: Gateway requires registry URL
 */
export async function testGatewayRequiresRegistryUrl() {
  await withEnv({
    YAMF_GATEWAY_URL: GATEWAY_URL,
    YAMF_REGISTRY_URL: undefined,
    YAMF_REGISTRY_TOKEN: REGISTRY_TOKEN
  }, async () => {
    await terminateAfter(
      () => gatewayServer(),
      async () => assertErr(
        async () => httpRequest(GATEWAY_URL, {
          body: { service: 'test', location: 'http://localhost:16000' },
          headers: buildRegistryUpdatedHeaders(REGISTRY_TOKEN)
        }),
        err => err.message.includes('YAMF_REGISTRY_URL'),
        err => err.message.includes('Required')
      )
    )
  })
}
