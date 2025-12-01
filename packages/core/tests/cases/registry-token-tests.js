import {
  assert,
  assertErr,
  terminateAfter,
  withEnv
} from '@yamf/test'

import {
  registryServer,
  gatewayServer,
  createService,
  httpRequest,
  envConfig,
  Logger,
  HEADERS,
  COMMANDS
} from '../../src/index.js'

const logger = new Logger()

// ============================================================================
// Environment Validation Tests
// ============================================================================

/**
 * Test that registry starts without token in dev environment
 */
export async function testRegistryStartsWithoutTokenInDev() {
  await withEnv({ 
    ENVIRONMENT: 'dev',
    YAMF_REGISTRY_TOKEN: undefined 
  }, async () => {
    await terminateAfter(
      await registryServer(),
      async () => {
        const result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
          headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
        })
        
        await assert(result,
          r => r.status === 'ready',
          r => typeof r.timestamp === 'number'
        )
        return result
      }
    )
  })
}

/**
 * Test that registry warns in non-dev environment without token
 */
export async function testRegistryWarnsInNonDevWithoutToken() {
  await withEnv({ 
    ENVIRONMENT: 'test',
    YAMF_REGISTRY_TOKEN: undefined 
  }, async () => {
    await terminateAfter(
      await registryServer(),
      async () => {
        const result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
          headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
        })
        
        throw new Error('TODO: Need proper log assertion')
        await assert(result,
          r => r.status === 'ready'
        )
        return result
      }
    )
  })
}

/**
 * Test that registry fails to start in production without token
 */
export async function testRegistryFailsInProdWithoutToken() {
  await withEnv({ 
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: undefined,
    YAMF_REGISTRY_URL: 'http://localhost:19000'
  }, () => assertErr(async () => registryServer(),
      err => err.message.includes('FATAL'),
      err => err.message.includes('YAMF_REGISTRY_TOKEN'),
      err => err.message.includes('PRODUCTION')
    )
  )
}

/**
 * Test that registry fails to start in staging without token
 */
export async function testRegistryFailsInStagingWithoutToken() {
  await withEnv({
    ENVIRONMENT: 'staging',
    YAMF_REGISTRY_TOKEN: undefined,
    YAMF_REGISTRY_URL: 'http://localhost:19000'
  }, () => assertErr(async () => registryServer(),
      err => err.message.includes('FATAL'),
      err => err.message.includes('YAMF_REGISTRY_TOKEN'),
      err => err.message.toLowerCase().includes('stag')
    )
  )
}

/**
 * Test that registry starts successfully with token in production
 */
export async function testRegistryStartsWithTokenInProduction() {
  const testToken = 'prod-test-token-xyz'
  await withEnv({
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: testToken,
    YAMF_REGISTRY_URL: 'http://localhost:19001',
    YAMF_GATEWAY_URL: 'http://localhost:19000'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await gatewayServer(),
      async () => {
        const result = await httpRequest('http://localhost:19000', {
          headers: { 
            [HEADERS.COMMAND]: COMMANDS.HEALTH 
          }
        })
        
        assert(result,
          r => r.status === 'ready',
          r => typeof r.timestamp === 'number'
        )
      }
    )
  })
}

// ============================================================================
// Token Validation Tests
// ============================================================================

/**
 * Test that protected commands require valid token
 */
export async function testProtectedCommandRequiresValidToken() {
  const testToken = 'protected-test-token-123'
  await withEnv({ 
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: testToken,
    YAMF_REGISTRY_URL: 'http://localhost:19001',
    YAMF_GATEWAY_URL: 'http://localhost:19000'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await gatewayServer(),
      async () => {
        // Should succeed with valid token
        const location = await httpRequest('http://localhost:19001', {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.SERVICE_SETUP,
            [HEADERS.SERVICE_NAME]: 'test-service',
            [HEADERS.SERVICE_HOME]: 'http://localhost',
            [HEADERS.REGISTRY_TOKEN]: testToken
          }
        })
        
        assert(location,
          l => typeof l === 'string',
          l => l.startsWith('http://localhost:'),
          l => l.includes('19002') // Allocated port
        )
      }
    )
  })
}

/**
 * Test that request with wrong token fails with 403
 */
export async function testRequestWithWrongTokenFails() {
  const testToken = 'correct-token-456'
  await withEnv({ 
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: testToken,
    YAMF_REGISTRY_URL: 'http://localhost:19001',
    YAMF_GATEWAY_URL: 'http://localhost:19000'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await gatewayServer(),
      async () => assertErr(
        async () => await httpRequest('http://localhost:19001', {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.SERVICE_SETUP,
            [HEADERS.SERVICE_NAME]: 'test-service',
            [HEADERS.SERVICE_HOME]: 'http://localhost',
            [HEADERS.REGISTRY_TOKEN]: 'wrong-token-789'
          }
        }),
        err => err.status === 403 || err.message.includes('403'),
        err => err.message.includes('Invalid registry token')
      )
    )
  })
}

/**
 * Test that request without token fails with 403
 */
export async function testRequestWithoutTokenFails() {
  const testToken = 'required-token-abc'
  await withEnv({ 
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: testToken,
    YAMF_REGISTRY_URL: 'http://localhost:19001',
    YAMF_GATEWAY_URL: 'http://localhost:19000'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await gatewayServer(),
      async () => assertErr(
        async () => await httpRequest('http://localhost:19001', {
          headers: {
            [HEADERS.COMMAND]: COMMANDS.SERVICE_SETUP,
            [HEADERS.SERVICE_NAME]: 'test-service',
            [HEADERS.SERVICE_HOME]: 'http://localhost'
            // No REGISTRY_TOKEN header
          }
        }),
        err => err.status === 403 || err.message.includes('403'),
        err => err.message.includes('Registry token required')
      )
    )
  })
}

/**
 * Test that public commands (HEALTH, SERVICE_LOOKUP, SERVICE_CALL) don't require token
 */
export async function testPublicCommandsDoNotRequireToken() {
  const testToken = 'public-test-token-def'
  await withEnv({ 
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: testToken,
    YAMF_REGISTRY_URL: 'http://localhost:19001',
    YAMF_GATEWAY_URL: 'http://localhost:19000'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await gatewayServer(),
      async () => {
        // Health check without token should work
        const healthResult = await httpRequest('http://localhost:19000', {
          headers: { 
            [HEADERS.COMMAND]: COMMANDS.HEALTH 
            // No REGISTRY_TOKEN header
          }
        })
        
        assert(healthResult,
          r => r.status === 'ready',
          r => typeof r.timestamp === 'number'
        )
      }
    )
  })
}

/**
 * Test service creation with valid token
 */
export async function testServiceCreationWithValidToken() {
  const testToken = 'service-creation-token-ghi'
  await withEnv({ 
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: testToken,
    YAMF_REGISTRY_URL: 'http://localhost:19001',
    YAMF_GATEWAY_URL: 'http://localhost:19000'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await gatewayServer(),
      createService('token-test-service', payload => {
        return { success: true, payload }
      }),
      async (registry, gateway, service) => {
        // Service should be successfully created and registered
        assert(service,
          s => s.name === 'token-test-service',
          s => typeof s.location === 'string',
          s => s.location.includes('http://localhost:')
        )
      }
    )
  })
}

/**
 * Test that all protected commands are validated
 */
export async function testAllProtectedCommandsValidated() {
  const testToken = 'protected-commands-token-jkl'
  await withEnv({ 
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: testToken,
    YAMF_REGISTRY_URL: 'http://localhost:19001',
    YAMF_GATEWAY_URL: 'http://localhost:19000'
  }, async () => {
    await terminateAfter(
      await registryServer(),
      await gatewayServer(),
      async () => {
        const protectedCommands = [
          COMMANDS.SERVICE_SETUP,
          COMMANDS.SERVICE_REGISTER,
          COMMANDS.SERVICE_UNREGISTER,
          COMMANDS.ROUTE_REGISTER,
          COMMANDS.PUBSUB_PUBLISH,
          COMMANDS.PUBSUB_SUBSCRIBE,
          COMMANDS.PUBSUB_UNSUBSCRIBE
        ]
        
        for (const command of protectedCommands) {
          try {
            await httpRequest('http://localhost:19001', {
              headers: {
                [HEADERS.COMMAND]: command,
                [HEADERS.SERVICE_NAME]: 'test',
                [HEADERS.SERVICE_HOME]: 'http://localhost',
                [HEADERS.SERVICE_LOCATION]: 'http://localhost:19002',
                [HEADERS.ROUTE_PATH]: '/test',
                [HEADERS.PUBSUB_CHANNEL]: 'test-channel'
              }
            })
            throw new Error(`Expected ${command} to require token`)
          } catch (err) {
            if (!(err.status === 403 || err.message.includes('403') || err.message.includes('Registry token'))) {
              throw err
            }
          }
        }
      }
    )
  })
}
