/**
 * Authentication System Tests
 * Tests for auth service integration, token verification, and protected service calls
 */

import {
  assert,
  assertErr,
  terminateAfter
} from '@yamf/test'

import {
  registryServer,
  createService,
  createRoute,
  callService,
  httpRequest,
  HttpError,
  envConfig,
  buildAuthLoginHeaders,
  buildAuthRefreshHeaders,
  buildCallHeaders,
  HEADERS
} from '../../../src/index.js'

import { default as createAuthService } from '../../../../services/auth/service.js'

const TEST_ADMIN_USER = process.env.ADMIN_USER
const TEST_ADMIN_SECRET = process.env.ADMIN_SECRET

/**
 * Test that auth service basic functionality works
 */
export async function testAuthServiceWorks() {
  await terminateAfter(
    await registryServer(),
    await createAuthService(),
    async () => {
      // Test authentication
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      // Test token verification
      const verifyResult = await callService('auth-service', {
        verifyAccess: authResult.accessToken
      })
      
      await assert([authResult, verifyResult],
        ([a,r]) => !!a.accessToken,
        ([a,r]) => r.status === 'valid access token'
      )
    }
  )
}


/**
 * Test that auth service basic functionality works
 */
export async function testAuthServiceBadCredentials() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    // Test invalid credentials
    () => assertErr(async () => callService('auth-service', {
        authenticate: {
          user: 'invalid',
          password: 'invalid'
        }
      }),
      err => err.status === 401
    )
  )
}

/**
 * Test that protected service requires auth token
 */
export async function testProtectedServiceWithAuth() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    createService('protected-service', payload => {
      return { message: 'Protected data accessed', timestamp: Date.now() }
    }, { useAuthService: 'auth-service' }),
    async () => {
      // Get auth token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      // Call protected service with token
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      const result = await httpRequest(registryHost, {
        body: { test: 'data' },
        headers: {
          ...buildCallHeaders('protected-service'),
          [HEADERS.AUTH_TOKEN]: authResult.accessToken
        }
      })
      
      assert(result,
        r => r.message === 'Protected data accessed'
      )
      
      // Try to call protected service without token
      await assertErr(
        async () => httpRequest(registryHost, {
          body: { test: 'data' },
          headers: buildCallHeaders('protected-service')
          // No AUTH_TOKEN header
        }),
        err => err.status === 401
      )
    }
  )
}

/**
 * Test that unprotected services still work normally
 */
export async function testUnprotectedServiceStillWorks() {
  await terminateAfter(
    registryServer(),
    createService('normal-service', payload => {
      return { message: 'Normal service works', data: payload }
    }),
    async () => {
      // Call normal service without any auth
      const result = await callService('normal-service', { test: 'data' })
      
      assert(result,
        r => r.message === 'Normal service works',
        r => r.data.test === 'data'
      )
    }
  )
}

/**
 * Test service registration with auth
 */
export async function testServiceRegistrationWithAuth() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    createService('protected-service', payload => {
      return { message: 'Protected data', user: payload.user }
    }, { useAuthService: 'auth-service' }),
    async (registry, authServer, protectedServer) => {
      assert(protectedServer.name, r => r === 'protected-service')
    }
  )
}

/**
 * Test protected service call with valid token
 */
export async function testProtectedServiceCallWithValidToken() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    createService('protected-service', () => {
      return { message: 'Protected data accessed', timestamp: Date.now() }
    }, { useAuthService: 'auth-service' }),
    async () => {
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      // Call protected service with token
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      const result = await httpRequest(registryHost, {
        body: { test: 'data' },
        headers: {
          ...buildCallHeaders('protected-service'),
          [HEADERS.AUTH_TOKEN]: authResult.accessToken
        }
      })
      
      assert(result, r => r.message === 'Protected data accessed')
    }
  )
}

/**
 * Test protected service call without token
 */
export async function testProtectedServiceCallWithoutToken() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    createService('protected-service', payload => {
      return { message: 'Should not reach here' }
    }, { useAuthService: 'auth-service' }),
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      await assertErr(
        async () => httpRequest(registryHost, {
          body: { test: 'data' },
          headers: buildCallHeaders('protected-service')
        }),
        err => err.status === 401
      )
    }
  )
}

/**
 * Test protected service call with invalid token
 */
export async function testProtectedServiceCallWithInvalidToken() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    createService('protected-service', payload => {
      return { message: 'Should not reach here' }
    }, { useAuthService: 'auth-service' }),
    async () => {
      // Call protected service with invalid token
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      await assertErr(
        async () => httpRequest(registryHost, {
          body: { test: 'data' },
          headers: {
            ...buildCallHeaders('protected-service'),
            [HEADERS.AUTH_TOKEN]: 'invalid-token'
          }
        }),
        err => err.status === 401
      )
    }
  )
}

/**
 * Test protected service call with expired token
 */
export async function testProtectedServiceCallWithExpiredToken() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      // Test that auth service rejects invalid/expired tokens
      await assertErr(
        async () => callService('auth-service', {
          verifyAccess: 'expired-or-invalid-token'
        }),
        err => err.status === 401,
        err => err.message === 'Invalid access token'
      )
    }
  )
}

/**
 * Test auth service not found error
 */
export async function testAuthServiceNotFound() {
  await terminateAfter(
    registryServer(),
    createService('protected-service', payload => {
      return { message: 'Should not reach here' }
    }, { useAuthService: 'nonexistent-auth-service' }),
    async () => {
      // Call protected service when auth service doesn't exist
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      await assertErr(
        async () => httpRequest(registryHost, {
          body: { test: 'data' },
          headers: {
            ...buildCallHeaders('protected-service'),
            [HEADERS.AUTH_TOKEN]: 'any-token'
          }
        }),
        err => err.status === 503 && err.message.includes('Auth service "nonexistent-auth-service" not found')
      )
    }
  )
}

/**
 * Test auth login command
 */
export async function testAuthLoginCommand() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      // Test login command
      const loginResult = await httpRequest(registryHost, {
        body: {
          authenticate: {
            user: TEST_ADMIN_USER,
            password: TEST_ADMIN_SECRET
          }
        },
        headers: buildAuthLoginHeaders()
      })
        
      assert(loginResult,
        r => !!r.accessToken
      )
    }
  )
}

/**
 * Test auth refresh command
 */
export async function testAuthRefreshCommand() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      // use fetch so we can parse the Set-Cookie header
      const response = await fetch(registryHost, {
        method: 'POST',
        body: JSON.stringify({
          authenticate: {
            user: TEST_ADMIN_USER,
            password: TEST_ADMIN_SECRET
          }
        }),
        headers: {
          ...buildAuthLoginHeaders(),
          'Content-Type': 'application/json'
        }
      })

      if (response.status !== 200) {
        throw new Error(`Failed to login: ${response.status} ${await response.text()}`)
      }

      const loginResult = await response.json()

      const refreshToken = response.headers.get('Set-Cookie').split('=')[1].split(';')[0]
      const refreshResult = await httpRequest(registryHost, {
        body: {},
        headers: {
          'Cookie': `refresh-token=${refreshToken}`,
          ...buildAuthRefreshHeaders()
        }
      })

      assert(refreshResult,
        r => r !== null,
        r => r.accessToken !== null
      )
    }
  )
}

/**
 * Test route with auth protection
 */
export async function testRouteWithAuth() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    createService('route-service', payload => {
      return { message: 'Route accessed', url: payload.url }
    }, { useAuthService: 'auth-service' }),
    async () => {
      // Register a route
      await createRoute('/api/protected', 'route-service')
      
      // Get auth token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      // Access route with token
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      const result = await httpRequest(`${registryHost}/api/protected`, {
        method: 'POST',
        body: { test: 'data' },
        headers: {
          [HEADERS.AUTH_TOKEN]: authResult.accessToken
        }
      })
      
      assert(result,
        r => r.message === 'Route accessed'
      )
      
      // Try to access route without token
      await assertErr(
        async () => httpRequest(`${registryHost}/api/protected`, {
          method: 'POST',
          body: { test: 'data' }
          // No AUTH_TOKEN header
        }),
        err => err.status === 401
      )
    }
  )
}

/**
 * Test multiple auth services
 */
export async function testMultipleAuthServices() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    createService('custom-auth-service', payload => {
      if (payload.verifyAccess) {
        // Simple custom auth - just check if token is 'custom-token'
        if (payload.verifyAccess === 'custom-token') {
          return { user: 'custom-user' }
        } else {
          throw new HttpError(401, 'Invalid custom token')
        }
      }
      throw new HttpError(400, 'Invalid payload')
    }),
    createService('service1', payload => {
      return { message: 'Service 1 accessed' }
    }, { useAuthService: 'auth-service' }),
    createService('service2', payload => {
      return { message: 'Service 2 accessed' }
    }, { useAuthService: 'custom-auth-service' }),
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      // Get token from first auth service
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      // Access service1 with standard auth token
      const result1 = await httpRequest(registryHost, {
        body: { test: 'data' },
        headers: {
          ...buildCallHeaders('service1'),
          [HEADERS.AUTH_TOKEN]: authResult.accessToken
        }
      })
      
      await assert(result1,
        r => r.message === 'Service 1 accessed'
      )
      
      // Access service2 with custom token
      const result2 = await httpRequest(registryHost, {
        body: { test: 'data' },
        headers: {
          ...buildCallHeaders('service2'),
          [HEADERS.AUTH_TOKEN]: 'custom-token'
        }
      })
      
      assert(result2,
        r => r.message === 'Service 2 accessed'
      )
      
      // Try to access service2 with standard token (should fail)
      await assertErr(
        async () => httpRequest(registryHost, {
          body: { test: 'data' },
          headers: {
            ...buildCallHeaders('service2'),
            [HEADERS.AUTH_TOKEN]: authResult.accessToken
          }
        }),
        err => err.status === 401
      )
    }
  )
}

/**
 * Test auth service unregistration cleanup
 */
export async function testAuthServiceUnregistration() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      const protectedServer = await createService('protected-service', payload => {
        return { message: 'Protected data' }
      }, { useAuthService: 'auth-service' })
      
      // Terminate the protected service
      await protectedServer.terminate()
      
      // The auth mapping should be cleaned up when the service is unregistered
      throw new Error('TODO verify auth service cleanup')
    }
  )
}
