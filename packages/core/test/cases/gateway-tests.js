/**
 * Gateway-Specific Tests
 * Tests for the API gateway functionality including:
 * - Pull-only security model
 * - Registry synchronization
 * - Service routing
 * - Health checks
 */

import { assert, assertErr, sleep, terminateAfter } from '../core/index.js'

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

// Helper to set environment temporarily
function setEnv(key, value) {
  if (value === undefined) {
    delete process.env[key]
    envConfig.config.delete(key)
  } else {
    process.env[key] = value
    envConfig.set(key, value)
  }
}

function withEnv(envVars, fn) {
  const saved = {}
  return async (...args) => {
    for (const key in envVars) {
      saved[key] = process.env[key]
      setEnv(key, envVars[key])
    }
    
    try {
      return await fn(...args)
    } finally {
      for (const key in saved) {
        if (saved[key] === undefined) {
          setEnv(key, undefined)
        } else {
          setEnv(key, saved[key])
        }
      }
    }
  }
}

/**
 * Test 1: Gateway health check
 */
async function testGatewayHealthCheck() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      gatewayServer(GATEWAY_PORT),
      async ([gateway]) => {
        const response = await httpRequest(GATEWAY_URL, {
          headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
        })
        
        await assert(response,
          r => r.status === 'ready',
          r => typeof r.timestamp === 'number'
        )
      }
    )
  })()
}

/**
 * Test 2: Gateway pre-registration
 */
async function testGatewayPreRegistration() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      async ([registry]) => {
        await sleep(100) // Give registry time to pre-register gateway
        
        // Query registry for gateway service
        const gatewayLocation = await httpRequest(REGISTRY_URL, {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
            [HEADERS.SERVICE_NAME]: 'yamf-gateway',
            [HEADERS.REGISTRY_TOKEN]: 'test-token'
          }
        })
        
        await assert(gatewayLocation,
          loc => loc === GATEWAY_URL
        )
      }
    )
  })()
}

/**
 * Test 3: Gateway pulls registry state
 */
async function testGatewayPullsState() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token',
    ENVIRONMENT: 'test'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      gatewayServer(GATEWAY_PORT),
      async ([registry, gateway]) => {
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
        
        await sleep(200) // Give time for async notification
        
        // Trigger manual pull to verify
        const registryState = await httpRequest(REGISTRY_URL, {
          headers: buildRegistryPullHeaders('test-token')
        })
        
        await assert(registryState,
          s => s.services !== undefined,
          s => s.services['test-service'] !== undefined,
          s => Array.isArray(s.services['test-service']),
          s => s.services['test-service'].includes(testServiceUrl),
          s => typeof s.timestamp === 'number'
        )
      }
    )
  })()
}

/**
 * Test 4: Gateway receives update notifications
 */
async function testGatewayUpdateNotification() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      gatewayServer(GATEWAY_PORT),
      async ([registry, gateway]) => {
        await sleep(100)
        
        // Send update notification to gateway
        const response = await httpRequest(GATEWAY_URL, {
          body: { service: 'test-service', location: 'http://localhost:16000' },
          headers: buildRegistryUpdatedHeaders('test-token')
        })
        
        await assert(response,
          r => r.status === 'updated',
          r => typeof r.servicesCount === 'number',
          r => typeof r.routesCount === 'number',
          r => typeof r.timestamp === 'number'
        )
      }
    )
  })()
}

/**
 * Test 5: Gateway rejects updates without token
 */
async function testGatewayRejectsUnauthorizedUpdates() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      gatewayServer(GATEWAY_PORT),
      async ([gateway]) => {
        await sleep(50)
        
        // Try to send update without token
        await assertErr(
          () => httpRequest(GATEWAY_URL, {
            body: { service: 'malicious-service', location: 'http://evil.com' },
            headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_UPDATED }
          }),
          err => err.message.includes('403') || err.message.includes('token')
        )
      }
    )
  })()
}

/**
 * Test 6: Gateway is not subscribed to push events
 */
async function testGatewayIsNotSubscribed() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token',
    ENVIRONMENT: 'test'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      gatewayServer(GATEWAY_PORT),
      await createService('normal-service', async () => {
        return { received: 'cache-update' }
      }),
      async ([registry, gateway, normalService]) => {
        await sleep(200)
        
        // Register another service - this will trigger cache updates
        await httpRequest(REGISTRY_URL, {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.SERVICE_REGISTER,
            [HEADERS.SERVICE_NAME]: 'another-service',
            [HEADERS.SERVICE_LOCATION]: 'http://localhost:16001',
            [HEADERS.REGISTRY_TOKEN]: 'test-token'
          }
        })
        
        await sleep(200)
        
        // Pull registry state to verify metadata
        const registryState = await httpRequest(REGISTRY_URL, {
          headers: buildRegistryPullHeaders('test-token')
        })
        
        const gatewayMetadata = registryState.serviceMetadata?.['yamf-gateway']
        
        await assert(gatewayMetadata,
          m => m !== undefined,
          m => m.pullOnly === true,
          m => m.public === true,
          m => m.type === 'gateway'
        )
      }
    )
  })()
}

/**
 * Test 7: Gateway routes to services
 */
async function testGatewayRoutesToServices() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token',
    ENVIRONMENT: 'test'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await createService('echo-service', async (payload) => {
        return { echo: payload }
      }),
      await createRoute('/api/echo', 'echo-service'),
      await gatewayServer(),
      async ([registry, echoService, route, gateway]) => {
        await sleep(300) // Give time for gateway to do initial pull
        
        // Call service through gateway via route
        const response = await httpRequest(`${GATEWAY_URL}/api/echo`, {
          method: 'POST',
          body: { message: 'hello' }
        })
        
        await assert(response,
          r => r.echo !== undefined,
          r => r.echo.message === 'hello'
        )
      }
    )
  })()
}

/**
 * Test 8: Gateway metadata is stored correctly
 */
async function testGatewayMetadataStorage() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      async ([registry]) => {
        await sleep(100)
        
        // Pull registry state to check metadata
        const state = await httpRequest(REGISTRY_URL, {
          headers: buildRegistryPullHeaders('test-token')
        })
        
        const gatewayMetadata = state.serviceMetadata?.['yamf-gateway']
        
        await assert(gatewayMetadata,
          m => m !== undefined,
          m => m.pullOnly === true,
          m => m.public === true,
          m => m.preregistered === true,
          m => m.type === 'gateway',
          m => typeof m.registeredAt === 'number'
        )
      }
    )
  })()
}

/**
 * Test 9: Gateway state reflects registry updates
 * Tests that gateway properly pulls and maintains registry state
 */
async function testGatewayStateReflectsRegistry() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: REGISTRY_URL,
    MICRO_REGISTRY_TOKEN: 'test-token',
    ENVIRONMENT: 'test'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await createService('test-service', async () => ({ test: true })),
      gatewayServer(),
      async ([registry, testService, gateway]) => {
        await sleep(200)
        
        // Register a route (should trigger gateway pull)
        await httpRequest(REGISTRY_URL, {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.ROUTE_REGISTER,
            [HEADERS.SERVICE_NAME]: 'test-service',
            [HEADERS.ROUTE_PATH]: '/api/test',
            [HEADERS.REGISTRY_TOKEN]: 'test-token'
          }
        })
        
        await sleep(200) // Give gateway time to pull
        
        // Pull gateway state (dev/test only endpoint)
        const gatewayState = await httpRequest(GATEWAY_URL, {
          headers: buildGatewayPullHeaders('test-token')
        })
        
        await assert(gatewayState,
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
  })()
}

/**
 * Test 10: Gateway requires registry URL
 */
async function testGatewayRequiresRegistryUrl() {
  await withEnv({
    MICRO_GATEWAY_URL: GATEWAY_URL,
    MICRO_REGISTRY_URL: undefined,
    MICRO_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    // Gateway should fail to process updates without registry URL
    await terminateAfter(
      gatewayServer(GATEWAY_PORT),
      async ([gateway]) => {
        await assertErr(
          () => httpRequest(GATEWAY_URL, {
            body: { service: 'test', location: 'http://localhost:16000' },
            headers: buildRegistryUpdatedHeaders('test-token')
          }),
          err => err.message.includes('MICRO_REGISTRY_URL') || 
                 err.message.includes('required') ||
                 err.message.includes('503')
        )
      }
    )
  })()
}

// Export all test functions
export default {
  testGatewayHealthCheck,
  testGatewayPreRegistration,
  testGatewayPullsState,
  testGatewayUpdateNotification,
  testGatewayRejectsUnauthorizedUpdates,
  testGatewayIsNotSubscribed,
  testGatewayRoutesToServices,
  testGatewayMetadataStorage,
  testGatewayStateReflectsRegistry,
  testGatewayRequiresRegistryUrl
}
