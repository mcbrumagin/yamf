/**
 * Gateway-Specific Tests
 * Tests for the API gateway functionality including:
 * - Pull-only security model
 * - Registry synchronization
 * - Service routing
 * - Health checks
 */

import { assert, assertErr, sleep, terminateAfter, withEnv } from '../core/index.js'

import {
  registryServer,
  gatewayServer,
  createService,
  createRoute,
  httpRequest,
  envConfig,
  HEADERS,
  COMMANDS,
  buildRegistryPullHeaders,
  buildRegistryUpdatedHeaders,
  buildGatewayPullHeaders
} from '../../src/index.js'

const GATEWAY_PORT = 15000
const REGISTRY_PORT = 15001
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`
const REGISTRY_URL = `http://localhost:${REGISTRY_PORT}`

/**
 * Test 1: Gateway health check
 */
export async function testGatewayHealthCheck() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      gatewayServer(),
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
  })
}

/**
 * Test 2: Gateway pre-registration
 */
export async function testGatewayPreRegistration() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      registryServer(),
      async () => {
        await sleep(100) // Give registry time to pre-register gateway
        
        // Query registry for gateway service
        const gatewayLocation = await httpRequest(REGISTRY_URL, {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
            [HEADERS.SERVICE_NAME]: 'yamf-gateway',
            [HEADERS.REGISTRY_TOKEN]: 'test-token'
          }
        })
        
        assert(gatewayLocation,
          loc => loc === GATEWAY_URL
        )
      }
    )
  })
}

/**
 * Test 3: Gateway pulls registry state
 */
export async function testGatewayPullsState() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token',
    ENVIRONMENT: 'test'
  }, async () => {
    await terminateAfter(
      registryServer(),
      gatewayServer(),
      async () => {
        // Register a test service with registry
        const testServiceUrl = 'http://localhost:16000'
        await httpRequest(REGISTRY_URL, {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.SERVICE_REGISTER,
            [HEADERS.SERVICE_NAME]: 'test-service',
            [HEADERS.SERVICE_LOCATION]: testServiceUrl,
            [HEADERS.REGISTRY_TOKEN]: 'test-token'
          }
        })
        
        await sleep(100) // Give time for async notification
        
        // Trigger manual pull to verify
        const registryState = await httpRequest(REGISTRY_URL, {
          headers: buildRegistryPullHeaders('test-token')
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
  })
}

/**
 * Test 4: Gateway receives update notifications
 */
export async function testGatewayUpdateNotification() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      registryServer(),
      gatewayServer(),
      async () => {
        await sleep(100)
        
        // Send update notification to gateway
        const response = await httpRequest(GATEWAY_URL, {
          body: { service: 'test-service', location: 'http://localhost:16000' },
          headers: buildRegistryUpdatedHeaders('test-token')
        })
        
        assert(response,
          r => r.status === 'updated',
          r => typeof r.servicesCount === 'number',
          r => typeof r.routesCount === 'number',
          r => typeof r.timestamp === 'number'
        )
      }
    )
  })
}

/**
 * Test 5: Gateway rejects updates without token
 */
export async function testGatewayRejectsUnauthorizedUpdates() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      gatewayServer(),
      async () => {
        await sleep(50)
        
        // Try to send update without token
        await assertErr(
          async () => httpRequest(GATEWAY_URL, {
            body: { service: 'malicious-service', location: 'http://evil.com' },
            headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_UPDATED }
          }),
          err => err.message.includes('403') || err.message.includes('token')
        )
      }
    )
  })
}

/**
 * Test 6: Gateway is not subscribed to push events
 */
export async function testGatewayIsNotSubscribed() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token',
    ENVIRONMENT: 'test'
  }, async () => {
    await terminateAfter(
      registryServer(),
      gatewayServer(),
      createService('normal-service', () => {
        return { received: 'cache-update' }
      }),
      async () => {
        await sleep(100)
        
        // Register another service - this will trigger cache updates
        await httpRequest(REGISTRY_URL, {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.SERVICE_REGISTER,
            [HEADERS.SERVICE_NAME]: 'another-service',
            [HEADERS.SERVICE_LOCATION]: 'http://localhost:16001',
            [HEADERS.REGISTRY_TOKEN]: 'test-token'
          }
        })
        
        await sleep(100)
        
        // Pull registry state to verify metadata
        const registryState = await httpRequest(REGISTRY_URL, {
          headers: buildRegistryPullHeaders('test-token')
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
  })
}

/**
 * Test 7: Gateway routes to services
 */
export async function testGatewayRoutesToServices() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token',
    ENVIRONMENT: 'test'
  }, async () => {
    await terminateAfter(
      registryServer(),
      createService('echo-service', payload => {
        return { echo: payload }
      }),
      createRoute('/api/echo', 'echo-service'),
      gatewayServer(),
      async () => {
        await sleep(100) // Give time for gateway to do initial pull
        
        // Call service through gateway via route
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
  })
}

/**
 * Test 8: Gateway metadata is stored correctly
 */
export async function testGatewayMetadataStorage() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      registryServer(),
      async () => {
        await sleep(100)
        
        // Pull registry state to check metadata
        const state = await httpRequest(REGISTRY_URL, {
          headers: buildRegistryPullHeaders('test-token')
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
  })
}

/**
 * Test 9: Gateway state reflects registry updates
 * Tests that gateway properly pulls and maintains registry state
 */
export async function testGatewayStateReflectsRegistry() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token',
    ENVIRONMENT: 'test'
  }, async () => {
    await terminateAfter(
      registryServer(),
      createService('test-service', () => ({ test: true })),
      gatewayServer(),
      async () => {
        await sleep(100)
        
        // Register a route (should trigger gateway pull)
        await httpRequest(REGISTRY_URL, {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.ROUTE_REGISTER,
            [HEADERS.SERVICE_NAME]: 'test-service',
            [HEADERS.ROUTE_PATH]: '/api/test',
            [HEADERS.REGISTRY_TOKEN]: 'test-token'
          }
        })
        
        await sleep(100) // Give gateway time to pull
        
        // Pull gateway state (dev/test only endpoint)
        const gatewayState = await httpRequest(GATEWAY_URL, {
          headers: buildGatewayPullHeaders('test-token')
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
  })
}

/**
 * Test 10: Gateway requires registry URL
 */
export async function testGatewayRequiresRegistryUrl() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: undefined,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    // Gateway should fail to process updates without registry URL
    await terminateAfter(
      await gatewayServer(),
      async () => assertErr(
        async () => httpRequest(GATEWAY_URL, {
          body: { service: 'test', location: 'http://localhost:16000' },
          headers: buildRegistryUpdatedHeaders('test-token')
        }),
        err => err.message.includes('MICRO_REGISTRY_URL'),
        err => err.message.includes('Required')
      )
    )
  })
}
