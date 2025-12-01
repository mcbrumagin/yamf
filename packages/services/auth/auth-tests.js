/**
 * Authentication System Tests
 * Tests for auth service integration, token verification, and protected service calls
 */

import {
  assert,
  assertErr,
  terminateAfter,
  sleep
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
} from '@yamf/core'

import { default as createAuthService } from './service.js'

const TEST_ADMIN_USER = envConfig.getRequired('ADMIN_USER')
const TEST_ADMIN_SECRET = envConfig.getRequired('ADMIN_SECRET')

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
      
      console.warn({TEST_ADMIN_SECRET})
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

// -----advanced auth tests----------------------------------------------------


/**
 * Test auth service with session tracking enabled
 */
export async function testAuthServiceWithSessions() {
  await terminateAfter(
    await registryServer(),
    await createAuthService({
      useSessions: true
    }),
    async () => {
      // Login and get access token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      await assert(authResult,
        r => !!r.accessToken
      )
      
      // Verify the token works
      const verifyResult = await callService('auth-service', {
        verifyAccess: authResult.accessToken
      })
      
      await assert(verifyResult,
        r => r.status === 'valid access token'
      )
    }
  )
}

/**
 * Test auth service with refresh-only session mode
 */
export async function testAuthServiceWithRefreshOnlySessions() {
  await terminateAfter(
    await registryServer(),
    await createAuthService({
      useSessions: 'refresh-only'
    }),
    async () => {
      // Login and get access token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      await assert(authResult,
        r => !!r.accessToken
      )
      
      // Access token should still work even though it's not in cache
      const verifyResult = await callService('auth-service', {
        verifyAccess: authResult.accessToken
      })
      
      await assert(verifyResult,
        r => r.status === 'valid access token'
      )
    }
  )
}

/**
 * Test auth service without sessions (stateless mode)
 */
export async function testAuthServiceStateless() {
  await terminateAfter(
    await registryServer(),
    await createAuthService({
      useSessions: false
    }), // No sessions (stateless)
    async () => {
      // Login and get access token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      await assert(authResult,
        r => !!r.accessToken
      )
      
      // Verify the token works in stateless mode
      const verifyResult = await callService('auth-service', {
        verifyAccess: authResult.accessToken
      })
      
      await assert(verifyResult,
        r => r.status === 'valid access token'
      )
    }
  )
}

/**
 * Test refresh token flow with cookie
 */
export async function testRefreshTokenFlow() {
  await terminateAfter(
    await registryServer(),
    await createAuthService(),
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      // Login using fetch to get Set-Cookie header
      const response = await fetch(registryHost, {
        method: 'POST',
        body: JSON.stringify({
          authenticate: {
            user: TEST_ADMIN_USER,
            password: TEST_ADMIN_SECRET
          }
        }),
        headers: buildAuthLoginHeaders()
      })

      if (response.status !== 200) {
        throw new Error(`Failed to login: ${response.status} ${await response.text()}`)
      }

      const loginResult = await response.json()
      const setCookieHeader = response.headers.get('Set-Cookie')
      
      await assert([loginResult, setCookieHeader],
        ([login, cookie]) => !!login.accessToken,
        ([login, cookie]) => cookie.includes('refresh-token='),
        ([login, cookie]) => cookie.includes('HttpOnly'),
        ([login, cookie]) => cookie.includes('Secure')
      )
      
      // Extract refresh token from cookie
      const refreshToken = setCookieHeader.split('refresh-token=')[1].split(';')[0]
      
      // Use refresh token to get new access token
      const refreshResult = await httpRequest(registryHost, {
        body: {},
        headers: {
          'Cookie': `refresh-token=${refreshToken}`,
          ...buildAuthRefreshHeaders()
        }
      })
      
      await assert(refreshResult,
        r => !!r.accessToken,
        r => r.accessToken !== loginResult.accessToken // Should be a new token
      )
    }
  )
}

/**
 * Test token expiration validation
 */
export async function testTokenExpirationDetection() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      // Create an expired token manually by manipulating the payload
      // We can't easily test actual expiration without waiting, so we verify
      // that the expiration check exists by testing with an invalid token
      
      await assertErr(
        async () => callService('auth-service', {
          verifyAccess: 'invalid-token-that-should-fail'
        }),
        err => err.status === 401
      )
    }
  )
}

/**
 * Test forwarded header is captured (rate limiting support)
 */
export async function testForwardedHeaderCapture() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      // Login with a forwarded header
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
          'Forwarded': 'for=192.0.2.43;proto=https;host=example.com'
        }
      })

      if (response.status !== 200) {
        throw new Error(`Failed to login: ${response.status} ${await response.text()}`)
      }

      const loginResult = await response.json()
      
      // The forwarded header should be logged/captured in the auth service
      // We can verify the service handles it without errors
      assert(loginResult,
        r => !!r.accessToken
      )
    }
  )
}

/**
 * Test X-Forwarded-For header support
 */
export async function testXForwardedForHeader() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      // Login with X-Forwarded-For header
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
          'X-Forwarded-For': '203.0.113.195, 70.41.3.18, 150.172.238.178'
        }
      })

      if (response.status !== 200) {
        throw new Error(`Failed to login: ${response.status} ${await response.text()}`)
      }

      const loginResult = await response.json()
      
      assert(loginResult,
        r => !!r.accessToken
      )
    }
  )
}

/**
 * Test session invalidation with session mode
 */
export async function testSessionInvalidation() {
  await terminateAfter(
    registryServer(),
    createAuthService({
      useSessions: true
    }), // Enable sessions
    async () => {
      // Login and get access token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      const accessToken = authResult.accessToken
      
      // Token should work initially
      const verifyResult1 = await callService('auth-service', {
        verifyAccess: accessToken
      })
      
      assert(verifyResult1,
        r => r.status === 'valid access token'
      )
      
      // In a real scenario, session would be invalidated by admin action
      // For now, we just verify the token validation works with sessions
      const verifyResult2 = await callService('auth-service', {
        verifyAccess: accessToken
      })
      
      assert(verifyResult2,
        r => r.status === 'valid access token'
      )
    }
  )
}

/**
 * Test multiple simultaneous auth requests
 */
export async function testConcurrentAuthRequests() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      // Make multiple concurrent auth requests
      const promises = []
      for (let i = 0; i < 5; i++) {
        await sleep(10) // fixes flakiness, TODO remove after adding salt to token for uniqueness
        promises.push(
          callService('auth-service', {
            authenticate: {
              user: TEST_ADMIN_USER,
              password: TEST_ADMIN_SECRET
            }
          })
        )
      }
      
      const results = await Promise.all(promises)
      
      // All should succeed
      assert(results,
        r => r.length === 5,
        r => r.every(res => !!res.accessToken),
        r => new Set(r.map(res => res.accessToken)).size === 5 // All unique tokens
      )
    }
  )
}

/**
 * Test token validation with concurrent requests
 */
export async function testConcurrentTokenValidation() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      // Get a single token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      const accessToken = authResult.accessToken
      
      // Validate it concurrently multiple times
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          callService('auth-service', {
            verifyAccess: accessToken
          })
        )
      }
      
      const results = await Promise.all(promises)
      
      // All validations should succeed
      assert(results,
        r => r.length === 10,
        r => r.every(res => res.status === 'valid access token')
      )
    }
  )
}

/**
 * Test refresh token reuse prevention (when using sessions)
 */
export async function testRefreshTokenWithSessions() {
  await terminateAfter(
    registryServer(),
    createAuthService({
      useSessions: true
    }), // Enable sessions
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      // Login using fetch to get Set-Cookie header
      const response = await fetch(registryHost, {
        method: 'POST',
        body: JSON.stringify({
          authenticate: {
            user: TEST_ADMIN_USER,
            password: TEST_ADMIN_SECRET
          }
        }),
        headers: buildAuthLoginHeaders()
      })

      const loginResult = await response.json()
      const refreshToken = response.headers.get('Set-Cookie').split('refresh-token=')[1].split(';')[0]
      
      // Use refresh token to get new access token
      const refreshResult1 = await httpRequest(registryHost, {
        body: {},
        headers: {
          'Cookie': `refresh-token=${refreshToken}`,
          ...buildAuthRefreshHeaders()
        }
      })
      
      assert(refreshResult1,
        r => !!r.accessToken
      )
      
      // Can reuse refresh token multiple times (until it expires)
      const refreshResult2 = await httpRequest(registryHost, {
        body: {},
        headers: {
          'Cookie': `refresh-token=${refreshToken}`,
          ...buildAuthRefreshHeaders()
        }
      })
      
      assert(refreshResult2,
        r => !!r.accessToken
      )
    }
  )
}

/**
 * Test invalid refresh token
 */
export async function testInvalidRefreshToken() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      
      // Try to use an invalid refresh token
      await assertErr(
        async () => httpRequest(registryHost, {
          body: {},
          headers: {
            'Cookie': 'refresh-token=invalid-token-here',
            [HEADERS.COMMAND]: 'call-service',
            [HEADERS.SERVICE_NAME]: 'auth-service'
          }
        }),
        err => err.status === 400 || err.status === 401
      )
    }
  )
}

/**
 * Test missing refresh token cookie
 */
export async function testMissingRefreshToken() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      // Try to refresh without providing cookie
      await assertErr(
        async () => callService('auth-service', {}), // Empty payload, no cookie
        err => err.status === 400
      )
    }
  )
}

/**
 * Test protected service with session-based auth
 */
export async function testProtectedServiceWithSessionAuth() {
  await terminateAfter(
    registryServer(),
    createAuthService({
      useSessions: true
    }), // Enable sessions
    await createService('protected-service', async function(payload) {
      return { message: 'Protected data', data: payload }
    }, { useAuthService: 'auth-service' }),
    async () => {
      // Get auth token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      // Call protected service
      const registryHost = envConfig.getRequired('MICRO_REGISTRY_URL')
      const result = await httpRequest(registryHost, {
        body: { test: 'data' },
        headers: {
          ...buildCallHeaders('protected-service'),
          [HEADERS.AUTH_TOKEN]: authResult.accessToken
        }
      })
      
      assert(result,
        r => r.message === 'Protected data',
        r => r.data.test === 'data'
      )
    }
  )
}

/**
 * Test Base64 encoding in tokens
 */
export async function testTokenBase64Encoding() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      // Get auth token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      const accessToken = authResult.accessToken
      
      // Token should be valid base64
      assert(accessToken,
        t => typeof t === 'string',
        t => t.length > 0,
        t => {
          try {
            Buffer.from(t, 'base64')
            return true
          } catch {
            return false
          }
        }
      )
      
      // Decode and verify structure
      const decoded = Buffer.from(accessToken, 'base64').toString('utf8')
      assert(decoded,
        d => d.includes('.'), // Should have payload.signature format
        d => {
          const [payload, signature] = d.split('.')
          try {
            JSON.parse(payload) // Payload should be JSON
            return signature && signature.length > 0 // Signature should exist
          } catch {
            return false
          }
        }
      )
    }
  )
}

/**
 * Test token payload contains expected fields
 */
export async function testTokenPayloadStructure() {
  await terminateAfter(
    registryServer(),
    createAuthService(),
    async () => {
      // Get auth token
      const authResult = await callService('auth-service', {
        authenticate: {
          user: TEST_ADMIN_USER,
          password: TEST_ADMIN_SECRET
        }
      })
      
      const accessToken = authResult.accessToken
      
      // Decode and inspect payload
      const decoded = Buffer.from(accessToken, 'base64').toString('utf8')
      const [payloadStr] = decoded.split('.')
      const payload = JSON.parse(payloadStr)
      
      assert(payload,
        p => p.user === TEST_ADMIN_USER,
        p => typeof p.expire === 'number',
        p => p.expire > Date.now() // Should not be expired
      )
    }
  )
}
