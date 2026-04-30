/**
 * Rate Limiter Integration Tests
 * 
 * Tests the pre-bind rate limiting API where:
 * - Rate limits are configured on registryServer/gatewayServer via options
 * - Services can require rate limit config with { rateLimit: true }
 * - Gateway can override registry configs
 */

import {
  assert,
  assertErr,
  sleep,
  terminateAfter,
} from '@yamf/test'

import {
  registryServer,
  gatewayServer,
  createService,
  httpRequest,
  callService,
  HEADERS,
  COMMANDS,
  envConfig,
} from '../../src/index.js'

const GATEWAY_URL = envConfig.get('YAMF_GATEWAY_URL')
const REGISTRY_URL = envConfig.get('YAMF_REGISTRY_URL')

// Helper to make multiple requests and count successes/failures
async function makeMultipleRequests(url, options, count) {
  const results = { success: 0, rateLimited: 0, errors: [] }
  
  for (let i = 0; i < count; i++) {
    try {
      await httpRequest(url, options)
      results.success++
    } catch (err) {
      if (err.status === 429) {
        results.rateLimited++
      } else {
        results.errors.push(err)
      }
    }
  }
  
  return results
}

/**
 * Test: Registry applies default rate limiting (pre-bind via options)
 */
export async function testRegistryDefaultRateLimit() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 5, maxTotalRequests: 100 }
      }
    }),
    async (registry) => {
      // Make requests - should allow 5, then rate limit
      const results = await makeMultipleRequests(REGISTRY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      }, 10)
      
      assert(results,
        r => r.success === 5,
        r => r.rateLimited === 5,
        r => r.errors.length === 0
      )
    }
  )
}

/**
 * Test: Service-specific rate limit (pre-bound on registry)
 */
export async function testServiceSpecificRateLimit() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 1000 },
        services: {
          'strict-service': { windowMs: 60000, maxRequestsPerIp: 3, maxTotalRequests: 1000 }
        }
      }
    }),
    () => createService('strict-service', async (payload) => {
      return { message: 'response', payload }
    }, { accessControl: 'public', rateLimit: true }),
    async (registry, strictService) => {
      // Should allow 3 requests, then rate limit
      await assertErr(async () => {
        for (let n of [1, 2, 3, 4, 5]) {
          await callService('strict-service', { test: n })
        }
      },
        err => err.status === 429,
        err => err.message.includes('Rate limit exceeded')
      )
    }
  )
}

/**
 * Test: Service registration fails if rateLimit: true but no config exists
 */
export async function testRateLimitRequiredButMissing() {
  await terminateAfter(
    () => registryServer(),  // No rate limit config
    async (registry) => {
      await assertErr(
        // TODO this service starts up successfully, which continues to occupy the port
        // the rate limit check needs to happen in the setup call, not the register call
        async () => createService('my-service', async () => ({}), { 
          accessControl: 'public',
          rateLimit: true  // Require rate limit config
        }),
        err => err.message.includes('No rate limit configured') || err.message.includes('rate limit'),
        err => err.message.includes('my-service')
      )
    }
  )
}

/**
 * Test: Service registration succeeds if rateLimit: true and default config exists
 */
export async function testRateLimitRequiredWithDefault() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 1000 }
        // No service-specific config, but default exists
      }
    }),
    () => createService('default-limited-service', async (payload) => {
      return { success: true }
    }, { accessControl: 'public', rateLimit: true }),
    async (registry, service) => {
      // Service should be registered successfully
      const result = await callService('default-limited-service', { test: true })
      assert(result, r => r.success === true)
    }
  )
}

/**
 * Test: Global rate limit protection (maxTotalRequests)
 */
export async function testGlobalRateLimitProtection() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 5, maxTotalRequests: 5 }
      }
    }),
    async (registry) => {
      // Both limits are 5, so 5 requests should succeed
      const results = await makeMultipleRequests(REGISTRY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      }, 10)
      
      assert(results,
        r => r.success === 5,
        r => r.rateLimited === 5
      )
    }
  )
}

/**
 * Test: Gateway with its own rate limit config
 */
export async function testGatewayDefaultRateLimit() {
  await terminateAfter(
    () => registryServer(),
    () => gatewayServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 5, maxTotalRequests: 100 }
      }
    }),
    async (registry, gateway) => {
      await sleep(100) // Let gateway sync
      
      const results = await makeMultipleRequests(GATEWAY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      }, 10)
      
      assert(results,
        r => r.success === 5,
        r => r.rateLimited === 5,
        r => r.errors.length === 0
      )
    }
  )
}

/**
 * Test: Gateway rate limit headers are returned
 */
export async function testGatewayRateLimitHeaders() {
  await terminateAfter(
    () => registryServer(),
    () => gatewayServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 1000 }
      }
    }),
    async (registry, gateway) => {
      await sleep(100)
      
      const http = await import('node:http')
      const headers = await new Promise((resolve, reject) => {
        const req = http.default.request(GATEWAY_URL, {
          method: 'GET',
          headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
        }, (res) => {
          resolve(res.headers)
          res.resume()
        })
        req.on('error', reject)
        req.end()
      })
      
      assert(headers,
        h => 'ratelimit-limit' in h,
        h => 'ratelimit-remaining' in h,
        h => 'ratelimit-reset' in h
      )
    }
  )
}

/**
 * Test: Rate limit window resets after expiry
 */
export async function testRateLimitWindowReset() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 1000, maxRequestsPerIp: 2, maxTotalRequests: 100 }
      }
    }),
    async (registry) => {
      // Exhaust the limit
      const firstBatch = await makeMultipleRequests(REGISTRY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      }, 3)
      
      assert(firstBatch,
        r => r.success === 2,
        r => r.rateLimited === 1
      )

      await sleep(1100) // Wait for window to reset
      
      // Should be able to make requests again
      const secondBatch = await makeMultipleRequests(REGISTRY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      }, 2)
      
      assert(secondBatch,
        r => r.success === 2,
        r => r.rateLimited === 0
      )
    }
  )
}

/**
 * Test: Multiple services with different rate limits (pre-bound)
 */
export async function testMultipleServicesWithDifferentLimits() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 1000 },
        services: {
          'fast-service': { windowMs: 60000, maxRequestsPerIp: 10, maxTotalRequests: 1000 },
          'slow-service': { windowMs: 60000, maxRequestsPerIp: 2, maxTotalRequests: 1000 }
        }
      }
    }),
    () => createService('fast-service', async (payload) => ({ speed: 'fast', payload })),
    () => createService('slow-service', async (payload) => ({ speed: 'slow', payload })),
    async (registry, fastService, slowService) => {
      // Call slow service - should only allow 2
      const slowResults = await makeMultipleRequests(REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
          [HEADERS.SERVICE_NAME]: 'slow-service',
          'content-type': 'application/json'
        },
        body: { test: 'slow' }
      }, 5)
      
      assert(slowResults,
        r => r.success === 2,
        r => r.rateLimited === 3
      )
    }
  )
}

/**
 * Test: Gateway service-specific rate limit (pre-bound)
 */
export async function testGatewayServiceRouteRateLimit() {
  await terminateAfter(
    () => registryServer(),
    () => createService('api-service', async (payload) => {
      return { received: payload }
    }, { accessControl: 'public' }),
    () => gatewayServer({
      rateLimit: {
        services: {
          'api-service': { windowMs: 60000, maxRequestsPerIp: 3, maxTotalRequests: 1000 }
        }
      }
    }),
    async (registry, apiService, gateway) => {
      await sleep(100)
      
      const results = await makeMultipleRequests(GATEWAY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
          [HEADERS.SERVICE_NAME]: 'api-service',
          'content-type': 'application/json'
        },
        body: { via: 'gateway' }
      }, 5)
      
      assert(results,
        r => r.success === 3,
        r => r.rateLimited === 2
      )
    }
  )
}

/**
 * Test: Rate limiting respects different IPs (via X-Forwarded-For header)
 */
export async function testRateLimitPerIPViaForwardedHeader() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 2, maxTotalRequests: 100 }
      }
    }),
    async (registry) => {
      // Requests from "IP 1"
      const ip1Results = await makeMultipleRequests(REGISTRY_URL, {
        headers: { 
          [HEADERS.COMMAND]: COMMANDS.HEALTH,
          'X-Forwarded-For': '192.168.1.100'
        }
      }, 3)
      
      assert(ip1Results,
        r => r.success === 2,
        r => r.rateLimited === 1
      )
      
      // Requests from "IP 2" - should get fresh quota
      const ip2Results = await makeMultipleRequests(REGISTRY_URL, {
        headers: { 
          [HEADERS.COMMAND]: COMMANDS.HEALTH,
          'X-Forwarded-For': '192.168.1.200'
        }
      }, 3)
      
      assert(ip2Results,
        r => r.success === 2,
        r => r.rateLimited === 1
      )
    }
  )
}

/**
 * Test: Service-specific limit overrides default
 */
export async function testServiceLimitOverridesDefault() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 1, maxTotalRequests: 100 },
        services: {
          'override-test-service': { windowMs: 60000, maxRequestsPerIp: 5, maxTotalRequests: 1000 }
        }
      }
    }),
    () => createService('override-test-service', async (payload) => {
      return { override: true, payload }
    }, { accessControl: 'public' }),
    async (registry, overrideService) => {
      // Service should use its own limit (5), not default (1)
      const results = await makeMultipleRequests(REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
          [HEADERS.SERVICE_NAME]: 'override-test-service',
          'content-type': 'application/json'
        },
        body: { test: 'override' }
      }, 7)
      
      assert(results,
        r => r.success === 5,
        r => r.rateLimited === 2
      )
    }
  )
}

/**
 * Test: Gateway overrides registry default (gateway has its own config)
 */
export async function testGatewayOverridesRegistryDefault() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        default: { windowMs: 60000, maxRequestsPerIp: 10, maxTotalRequests: 1000 }
      }
    }),
    () => gatewayServer({
      rateLimit: {
        // Gateway has stricter default than registry
        default: { windowMs: 60000, maxRequestsPerIp: 3, maxTotalRequests: 100 }
      }
    }),
    async (registry, gateway) => {
      await sleep(100)
      
      // Gateway should use its own limit (3), not registry's (10)
      const results = await makeMultipleRequests(GATEWAY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      }, 6)
      
      assert(results,
        r => r.success === 3,
        r => r.rateLimited === 3
      )
    }
  )
}

/**
 * Test: Custom key function for rate limiting (e.g., by username)
 */
export async function testCustomKeyFunctionRateLimit() {
  await terminateAfter(
    () => registryServer({
      rateLimit: {
        services: {
          'auth': {
            windowMs: 60000,
            maxRequestsPerIp: 100,  // High IP limit
            maxTotalRequests: 1000,
            maxRequestsPerCustomKey: 2,  // Low per-username limit
            customKeyFn: (payload) => payload?.username
          }
        }
      }
    }),
    () => createService('auth', async (payload) => {
      return { authenticated: true, user: payload.username }
    }, { accessControl: 'public', rateLimit: true }),
    async (registry, authService) => {
      // Same username should be rate limited after 2 requests
      const results = { success: 0, rateLimited: 0 }
      
      for (let i = 0; i < 5; i++) {
        try {
          await callService('auth', { username: 'alice' })
          results.success++
        } catch (err) {
          if (err.status === 429) results.rateLimited++
        }
      }
      
      assert(results,
        r => r.success === 2,
        r => r.rateLimited === 3
      )
      
      // Different username should get fresh quota
      const bobResult = await callService('auth', { username: 'bob' })
      assert(bobResult, r => r.authenticated === true)
    }
  )
}
