/**
 * Rate Limiter Tests
 * Tests for rate limiting functionality
 */

import {
  assert,
  assertErr
} from '@yamf/test'

import {
  createRateLimiterState,
  resetRateLimiterState,
  getOrCreateBucket,
  cleanExpiredEntries,
  getRateLimiterStats
} from '../../src/rate-limiter/rate-limiter-state.js'

import {
  checkRateLimit,
  extractClientIp,
  isIpv4,
  isIpv6,
  setServiceRateLimit,
  setDefaultRateLimit,
  removeServiceRateLimit,
  clearRateLimitTracking,
  initializeRateLimiter
} from '../../src/rate-limiter/rate-limiter.js'

import {
  DEFAULT_RATE_LIMIT_CONFIG,
  AUTH_RATE_LIMIT_CONFIG,
  validateConfig,
  mergeConfig,
  createAuthKeyFn,
  serializeConfig,
  deserializeConfig
} from '../../src/rate-limiter/rate-limiter-config.js'

// ==================== State Tests ====================

export async function testCreateRateLimiterState() {
  const state = createRateLimiterState()
  
  assert(state.ipv4Buckets, buckets => buckets instanceof Map)
  assert(state.customBuckets, buckets => buckets instanceof Map)
  assert(state.serviceConfigs, configs => configs instanceof Map)
  assert(state.globalCounter.count, count => count === 0)
  assert(state.globalCounter.requests, requests => Array.isArray(requests))
}

export async function testResetRateLimiterState() {
  const state = createRateLimiterState()
  
  // Add some data
  state.ipv4Buckets.set('192.168.1.1', { count: 5, requests: [1, 2, 3] })
  state.globalCounter.count = 10
  
  resetRateLimiterState(state)
  
  assert(state.ipv4Buckets.size, size => size === 0)
  assert(state.globalCounter.count, count => count === 0)
}

export async function testGetOrCreateBucket() {
  const buckets = new Map()
  const now = Date.now()
  
  // First call creates bucket
  const bucket1 = getOrCreateBucket(buckets, '192.168.1.1', now)
  assert(bucket1.count, count => count === 0)
  
  // Second call returns same bucket
  bucket1.count = 5
  const bucket2 = getOrCreateBucket(buckets, '192.168.1.1', now)
  assert(bucket2.count, count => count === 5)
}

export async function testCleanExpiredEntries() {
  const buckets = new Map()
  const now = Date.now()
  const windowMs = 1000
  
  // Add a bucket with old and new requests
  buckets.set('192.168.1.1', {
    count: 3,
    windowStart: now - 2000,
    requests: [now - 2000, now - 500, now - 100]
  })
  
  cleanExpiredEntries(buckets, windowMs, now)
  
  const bucket = buckets.get('192.168.1.1')
  assert(bucket.count, count => count === 2)
  assert(bucket.requests.length, len => len === 2)
}

export async function testCleanExpiredEntriesRemovesEmptyBuckets() {
  const buckets = new Map()
  const now = Date.now()
  const windowMs = 1000
  
  // Add a bucket with only old requests
  buckets.set('192.168.1.1', {
    count: 2,
    windowStart: now - 5000,
    requests: [now - 3000, now - 2000]
  })
  
  cleanExpiredEntries(buckets, windowMs, now)
  
  assert(buckets.size, size => size === 0)
}

// ==================== IP Extraction Tests ====================

export async function testExtractClientIp_ForwardedHeader() {
  const request = {
    headers: {
      'forwarded': 'for=192.168.1.100;by=proxy.example.com'
    },
    socket: { remoteAddress: '127.0.0.1' }
  }
  
  const ip = extractClientIp(request)
  assert(ip, val => val === '192.168.1.100')
}

export async function testExtractClientIp_XForwardedFor() {
  const request = {
    headers: {
      'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3'
    },
    socket: { remoteAddress: '127.0.0.1' }
  }
  
  const ip = extractClientIp(request)
  assert(ip, val => val === '10.0.0.1')
}

export async function testExtractClientIp_DirectConnection() {
  const request = {
    headers: {},
    socket: { remoteAddress: '172.16.0.1' }
  }
  
  const ip = extractClientIp(request)
  assert(ip, val => val === '172.16.0.1')
}

export async function testExtractClientIp_IPv4MappedIPv6() {
  const request = {
    headers: {},
    socket: { remoteAddress: '::ffff:192.168.1.1' }
  }
  
  const ip = extractClientIp(request)
  assert(ip, val => val === '192.168.1.1')
}

export async function testIsIpv4() {
  assert(isIpv4('192.168.1.1'), val => val === true)
  assert(isIpv4('10.0.0.1'), val => val === true)
  assert(isIpv4('::1'), val => val === false)
  assert(isIpv4('invalid'), val => val === false)
}

export async function testIsIpv6() {
  assert(isIpv6('::1'), val => val === true)
  assert(isIpv6('2001:db8::1'), val => val === true)
  assert(isIpv6('192.168.1.1'), val => val === false)
}

// ==================== Config Tests ====================

export async function testValidateConfig_Valid() {
  const config = validateConfig({
    windowMs: 30000,
    maxRequestsPerIp: 50
  })
  
  assert(config.windowMs, val => val === 30000)
  assert(config.maxRequestsPerIp, val => val === 50)
  assert(config.maxTotalRequests, val => val === DEFAULT_RATE_LIMIT_CONFIG.maxTotalRequests)
}

export async function testValidateConfig_InvalidWindowMs() {
  await assertErr(
    () => validateConfig({ windowMs: 500 }),
    err => err.message.includes('windowMs')
  )
}

export async function testValidateConfig_InvalidMaxRequests() {
  await assertErr(
    () => validateConfig({ maxRequestsPerIp: 0 }),
    err => err.message.includes('maxRequestsPerIp')
  )
}

export async function testValidateConfig_TotalLessThanPerIp() {
  await assertErr(
    () => validateConfig({ maxRequestsPerIp: 100, maxTotalRequests: 50 }),
    err => err.message.includes('maxTotalRequests')
  )
}

export async function testMergeConfig() {
  const base = { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 10000, maxRequestsPerCustomKey: 10, customKeyFn: null }
  const override = { maxRequestsPerIp: 50 }
  
  const merged = mergeConfig(base, override)
  
  assert(merged.windowMs, val => val === 60000)
  assert(merged.maxRequestsPerIp, val => val === 50)
}

export async function testCreateAuthKeyFn() {
  const keyFn = createAuthKeyFn(['username', 'email'])
  
  assert(keyFn({ username: 'TestUser' }), val => val === 'testuser')
  assert(keyFn({ email: 'Test@Example.com' }), val => val === 'test@example.com')
  assert(keyFn({ other: 'value' }), val => val === null)
}

export async function testSerializeDeserializeConfig() {
  const config = {
    windowMs: 30000,
    maxRequestsPerIp: 50,
    maxTotalRequests: 5000,
    maxRequestsPerCustomKey: 5,
    customKeyFn: () => 'test'
  }
  
  const serialized = serializeConfig(config)
  assert(serialized.hasCustomKeyFn, val => val === true)
  
  const deserialized = deserializeConfig(serialized)
  assert(deserialized.windowMs, val => val === 30000)
  assert(deserialized.customKeyFn, val => val === null)
}

// ==================== Rate Limit Check Tests ====================

export async function testCheckRateLimit_AllowsWithinLimit() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, { windowMs: 60000, maxRequestsPerIp: 10, maxTotalRequests: 1000 })
  
  const request = {
    headers: {},
    socket: { remoteAddress: '192.168.1.1' }
  }
  
  const result = checkRateLimit(state, request)
  
  assert(result,
    r => r.allowed === true,
    r => r.error === null
  )
  assert(result,
    r => r.headers['RateLimit-Remaining'] >= 0,
    r => r.headers['RateLimit-Limit'] === '10'
  )
}

export async function testCheckRateLimit_BlocksAfterLimit() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, { windowMs: 60000, maxRequestsPerIp: 3, maxTotalRequests: 1000 })
  
  const request = {
    headers: {},
    socket: { remoteAddress: '192.168.1.1' }
  }
  
  // Make requests up to limit
  checkRateLimit(state, request)
  checkRateLimit(state, request)
  checkRateLimit(state, request)
  
  // This should be blocked
  const result = checkRateLimit(state, request)
  
  assert(result, r => r.allowed === false)
  // Check error exists (can't use assert directly on Error objects)
  assertErr(result.error, err => err.status === 429)
  assert(result.headers, h => 'Retry-After' in h)
}

export async function testCheckRateLimit_DifferentIpsIndependent() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, { windowMs: 60000, maxRequestsPerIp: 2, maxTotalRequests: 1000 })
  
  const request1 = { headers: {}, socket: { remoteAddress: '192.168.1.1' } }
  const request2 = { headers: {}, socket: { remoteAddress: '192.168.1.2' } }
  
  // Exhaust limit for IP 1
  checkRateLimit(state, request1)
  checkRateLimit(state, request1)
  const blocked = checkRateLimit(state, request1)
  
  // IP 2 should still be allowed
  const result = checkRateLimit(state, request2)
  
  assert(blocked, r => r.allowed === false)
  assert(result, r => r.allowed === true)
}

export async function testCheckRateLimit_GlobalLimit() {
  const state = createRateLimiterState()
  // maxTotalRequests must be >= maxRequestsPerIp
  setDefaultRateLimit(state, { windowMs: 60000, maxRequestsPerIp: 5, maxTotalRequests: 5 })
  
  // Make requests from different IPs to hit global limit
  for (let i = 0; i < 5; i++) {
    const request = { headers: {}, socket: { remoteAddress: `192.168.1.${i}` } }
    checkRateLimit(state, request)
  }
  
  // This should be blocked by global limit
  const request = { headers: {}, socket: { remoteAddress: '192.168.1.100' } }
  const result = checkRateLimit(state, request)
  
  assert(result,
    r => r.allowed === false,
    r => r.reason === 'global'
  )
}

export async function testCheckRateLimit_ServiceSpecificConfig() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 10000 })
  setServiceRateLimit(state, 'auth', { windowMs: 60000, maxRequestsPerIp: 2, maxTotalRequests: 10000 })
  
  const request = { headers: {}, socket: { remoteAddress: '192.168.1.1' } }
  
  // Requests without service name use default (high limit)
  checkRateLimit(state, request)
  checkRateLimit(state, request)
  checkRateLimit(state, request)
  const defaultResult = checkRateLimit(state, request)
  
  // Reset for clean test
  clearRateLimitTracking(state)
  
  // Requests for auth-service use stricter limit
  checkRateLimit(state, request, { serviceName: 'auth' })
  checkRateLimit(state, request, { serviceName: 'auth' })
  const authResult = checkRateLimit(state, request, { serviceName: 'auth' })
  
  assert(defaultResult, r => r.allowed === true)
  assert(authResult, r => r.allowed === false)
}

export async function testCheckRateLimit_CustomKeyFunction() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, {
    windowMs: 60000,
    maxRequestsPerIp: 100,
    maxTotalRequests: 10000,
    maxRequestsPerCustomKey: 2,
    customKeyFn: (payload) => payload?.username || null
  })
  
  const request = { headers: {}, socket: { remoteAddress: '192.168.1.1' } }
  
  // Same username should be rate limited
  checkRateLimit(state, request, { payload: { username: 'testuser' } })
  checkRateLimit(state, request, { payload: { username: 'testuser' } })
  const blockedResult = checkRateLimit(state, request, { payload: { username: 'testuser' } })
  
  // Different username should be allowed
  const allowedResult = checkRateLimit(state, request, { payload: { username: 'otheruser' } })
  
  assert(blockedResult,
    r => r.allowed === false,
    r => r.reason === 'custom'
  )
  assert(allowedResult,
    r => r.allowed === true
  )
}

export async function testCheckRateLimit_ReturnsHeaders() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, { windowMs: 60000, maxRequestsPerIp: 10, maxTotalRequests: 1000 })
  
  const request = { headers: {}, socket: { remoteAddress: '192.168.1.1' } }
  
  const result = checkRateLimit(state, request)
  
  assert(result.headers,
    h => 'RateLimit-Limit' in h,
    h => 'RateLimit-Remaining' in h,
    h => 'RateLimit-Reset' in h,
    h => h['RateLimit-Limit'] === '10'
  )
}

// ==================== Service Rate Limit Configuration Tests ====================

export async function testSetServiceRateLimit() {
  const state = createRateLimiterState()
  
  setServiceRateLimit(state, 'my-service', { windowMs: 30000, maxRequestsPerIp: 50 })
  
  assert(state,
    s => s.serviceConfigs.has('my-service'),
    s => s.serviceConfigs.get('my-service').windowMs === 30000
  )
}

export async function testRemoveServiceRateLimit() {
  const state = createRateLimiterState()
  setServiceRateLimit(state, 'my-service', { windowMs: 30000, maxRequestsPerIp: 50 })
  
  removeServiceRateLimit(state, 'my-service')
  
  assert(state, s => !s.serviceConfigs.has('my-service'))
}

export async function testClearRateLimitTracking() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, { windowMs: 60000, maxRequestsPerIp: 10 })
  
  // Generate some tracking data
  const request = { headers: {}, socket: { remoteAddress: '192.168.1.1' } }
  checkRateLimit(state, request)
  checkRateLimit(state, request)
  
  clearRateLimitTracking(state)
  
  assert(state,
    s => s.ipv4Buckets.size === 0,
    s => s.globalCounter.count === 0,
    s => s.stats.totalRequests === 0
  )
}

export async function testInitializeRateLimiter() {
  const gatewayState = { services: new Map() }
  
  const rateLimiter = initializeRateLimiter(gatewayState, { 
    windowMs: 30000, 
    maxRequestsPerIp: 50,
    maxTotalRequests: 5000
  })
  
  assert(gatewayState,
    s => s.rateLimiter === rateLimiter,
    s => s.rateLimiter.defaultConfig.windowMs === 30000
  )
}

// ==================== Stats Tests ====================

export async function testGetRateLimiterStats() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, { windowMs: 60000, maxRequestsPerIp: 10 })
  setServiceRateLimit(state, 'service1', { windowMs: 30000, maxRequestsPerIp: 5 })
  
  const request = { headers: {}, socket: { remoteAddress: '192.168.1.1' } }
  checkRateLimit(state, request)
  
  const stats = getRateLimiterStats(state)
  
  assert(stats,
    s => s.ipv4BucketCount === 1,
    s => s.serviceConfigCount === 1,
    s => s.hasDefaultConfig === true,
    s => s.totalRequests >= 1
  )
}

// ==================== Auth Rate Limit Config Tests ====================

export async function testAuthRateLimitConfig() {
  const state = createRateLimiterState()
  setDefaultRateLimit(state, AUTH_RATE_LIMIT_CONFIG)
  
  // Verify config values are stricter
  assert(state,
    s => s.defaultConfig.maxRequestsPerIp <= 20,
    s => s.defaultConfig.maxRequestsPerCustomKey <= 5
  )
  
  const request = { headers: {}, socket: { remoteAddress: '192.168.1.1' } }
  
  // Test that username is rate limited
  for (let i = 0; i < 5; i++) {
    checkRateLimit(state, request, { payload: { username: 'testuser' } })
  }
  
  const result = checkRateLimit(state, request, { payload: { username: 'testuser' } })
  assert(result,
    r => r.allowed === false,
    r => r.reason === 'custom'
  )
}
