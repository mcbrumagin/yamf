/**
 * Rate Limiter
 * Core rate limiting logic using sliding window algorithm
 * 
 * Features:
 * - Per-IP rate limiting (IPv4)
 * - Global rate limiting (brute force protection)
 * - Custom key rate limiting (e.g., per-username for auth)
 * - Service-specific configurations
 * - Standard rate limit headers (RFC draft-ietf-httpapi-ratelimit-headers)
 * 
 * TODO: IPv6 support
 * TODO: CIDR block rate limiting
 */

import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'
import net from 'node:net'
import { 
  getOrCreateBucket, 
  cleanExpiredEntries,
  createRateLimiterState 
} from './rate-limiter-state.js'
import { 
  DEFAULT_RATE_LIMIT_CONFIG, 
  mergeConfig,
  validateConfig 
} from './rate-limiter-config.js'

const logger = new Logger({ logGroup: 'yamf-rate-limiter' })

// Cleanup frequency (1 in N requests triggers cleanup)
const CLEANUP_FREQUENCY = 100

/**
 * Extract client IP from request
 * Handles Forwarded header (RFC 7239), X-Forwarded-For, and direct connections
 * 
 * @param {Object} request - HTTP request object
 * @returns {string} Client IP address
 */
export function extractClientIp(request) {
  // Check Forwarded header first (modern standard - RFC 7239)
  const forwarded = request.headers?.['forwarded']
  if (forwarded) {
    // Parse: for="192.168.1.1";by="proxy";host="example.com"
    const match = forwarded.match(/for=["']?([^"',;\s]+)/i)
    if (match) {
      let ip = match[1]
      // Remove brackets and port from IPv6: [::1]:8080 -> ::1
      if (ip.startsWith('[')) {
        ip = ip.replace(/^\[([^\]]+)\].*/, '$1')
      } else {
        // Remove port from IPv4: 192.168.1.1:8080 -> 192.168.1.1
        ip = ip.split(':')[0]
      }
      return ip
    }
  }
  
  // Fallback to X-Forwarded-For (older standard)
  const xForwardedFor = request.headers?.['x-forwarded-for']
  if (xForwardedFor) {
    // Take first IP (original client) from comma-separated list
    return xForwardedFor.split(',')[0].trim()
  }
  
  // Direct connection - use socket remote address
  let remoteAddress = request.socket?.remoteAddress
  if (remoteAddress) {
    // Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1 -> 192.168.1.1)
    if (remoteAddress.startsWith('::ffff:')) {
      remoteAddress = remoteAddress.slice(7)
    }
    return remoteAddress
  }
  
  return 'unknown'
}

/**
 * Check if IP is IPv4
 * 
 * @param {string} ip - IP address string
 * @returns {boolean} True if IPv4
 */
export function isIpv4(ip) {
  return net.isIPv4(ip)
}

/**
 * Check if IP is IPv6
 * 
 * @param {string} ip - IP address string
 * @returns {boolean} True if IPv6
 */
export function isIpv6(ip) {
  return net.isIPv6(ip)
}

// TODO: Implement IPv6 normalization
// IPv6 addresses can be written multiple ways:
// - ::1, 0:0:0:0:0:0:0:1, 0000:0000:0000:0000:0000:0000:0000:0001
// All should be treated as the same address
// export function normalizeIpv6(ip) { ... }

// TODO: Implement CIDR block matching
// Useful for rate limiting entire subnets
// export function matchesCidrBlock(ip, cidr) { ... }
// export function findMatchingCidrBlock(ip, cidrList) { ... }

/**
 * Record a request and check if rate limited
 * Uses sliding window algorithm
 * 
 * @param {Object} bucket - Request bucket
 * @param {number} maxRequests - Maximum requests allowed in window
 * @param {number} windowMs - Window size in milliseconds
 * @param {number} now - Current timestamp
 * @returns {Object} { limited, remaining, resetMs, retryAfterMs }
 */
function recordAndCheck(bucket, maxRequests, windowMs, now = Date.now()) {
  // Clean old requests from this bucket (sliding window)
  bucket.requests = bucket.requests.filter(ts => now - ts < windowMs)
  bucket.count = bucket.requests.length
  
  // Check if limited BEFORE recording this request
  const limited = bucket.count >= maxRequests
  
  if (!limited) {
    bucket.requests.push(now)
    bucket.count++
  }
  
  // Calculate reset time (when oldest request expires)
  const oldestRequest = bucket.requests[0] || now
  const resetMs = Math.max(0, windowMs - (now - oldestRequest))
  
  return {
    limited,
    remaining: Math.max(0, maxRequests - bucket.count),
    resetMs,
    retryAfterMs: limited ? resetMs : 0
  }
}

/**
 * Build rate limit response with headers
 * 
 * @param {boolean} allowed - Whether request is allowed
 * @param {Object} result - Rate limit check result
 * @param {Object} config - Rate limit configuration
 * @returns {Object} { allowed, headers, error }
 */
function buildRateLimitResponse(allowed, result, config) {
  const { remaining, resetMs, retryAfterMs, reason, clientIp, customKey } = result
  
  // Standard rate limit headers (draft-ietf-httpapi-ratelimit-headers)
  const headers = {
    'RateLimit-Limit': String(config.maxRequestsPerIp),
    'RateLimit-Remaining': String(remaining),
    'RateLimit-Reset': String(Math.ceil(resetMs / 1000)) // seconds until reset
  }
  
  if (!allowed) {
    headers['Retry-After'] = String(Math.ceil(retryAfterMs / 1000))
  }
  
  return {
    allowed,
    headers,
    reason: allowed ? null : reason,
    clientIp,
    error: allowed ? null : new HttpError(429, buildRateLimitMessage(reason, config))
  }
}

/**
 * Build human-readable rate limit message
 * 
 * @param {string} reason - Rate limit reason (global, ip, custom)
 * @param {Object} config - Rate limit configuration
 * @returns {string} Error message
 */
function buildRateLimitMessage(reason, config) {
  const windowSec = Math.ceil(config.windowMs / 1000)
  
  switch (reason) {
    case 'global':
      return 'Service is experiencing high traffic. Please try again later.'
    case 'ip':
      return `Rate limit exceeded. Maximum ${config.maxRequestsPerIp} requests per ${windowSec} seconds.`
    case 'custom':
      return `Rate limit exceeded for this resource. Maximum ${config.maxRequestsPerCustomKey} requests per ${windowSec} seconds.`
    default:
      return 'Too many requests. Please try again later.'
  }
}

/**
 * Main rate limit check
 * Checks global, per-IP, and custom key limits
 * 
 * @param {Object} state - Rate limiter state
 * @param {Object} request - HTTP request object
 * @param {Object} options - Options { serviceName, payload }
 * @returns {Object} { allowed, headers, error, reason, clientIp }
 */
export function checkRateLimit(state, request, options = {}) {
  const { serviceName, payload } = options
  const now = Date.now()
  
  // Get config (service-specific or default)
  let config = DEFAULT_RATE_LIMIT_CONFIG
  
  if (serviceName && state.serviceConfigs.has(serviceName)) {
    config = mergeConfig(config, state.serviceConfigs.get(serviceName))
  } else if (state.defaultConfig) {
    config = mergeConfig(config, state.defaultConfig)
  }
  
  const { 
    windowMs, 
    maxRequestsPerIp, 
    maxTotalRequests, 
    customKeyFn, 
    maxRequestsPerCustomKey 
  } = config
  
  // Extract client IP
  const clientIp = extractClientIp(request)
  
  // Update stats
  state.stats.totalRequests++
  
  // Periodic cleanup (probabilistic to avoid performance hit)
  if (Math.random() < (1 / CLEANUP_FREQUENCY)) {
    cleanExpiredEntries(state.ipv4Buckets, windowMs, now)
    cleanExpiredEntries(state.customBuckets, windowMs, now)
    state.stats.lastCleanup = now
  }
  
  // Track individual check results for combined remaining calculation
  const results = []
  
  // 1. Check global rate limit (brute force protection)
  const globalBucket = state.globalCounter
  globalBucket.requests = globalBucket.requests.filter(ts => now - ts < windowMs)
  globalBucket.count = globalBucket.requests.length
  
  if (globalBucket.count >= maxTotalRequests) {
    const resetMs = windowMs - (now - globalBucket.requests[0])
    state.stats.totalBlocked++
    logger.warn(`Global rate limit exceeded (${globalBucket.count}/${maxTotalRequests})`)
    
    return buildRateLimitResponse(false, {
      remaining: 0,
      resetMs,
      retryAfterMs: resetMs,
      reason: 'global',
      clientIp
    }, config)
  }
  
  // Record global request (after check)
  globalBucket.requests.push(now)
  globalBucket.count++
  
  // 2. Check per-IP rate limit
  if (isIpv4(clientIp)) {
    const ipBucket = getOrCreateBucket(state.ipv4Buckets, clientIp, now)
    const ipResult = recordAndCheck(ipBucket, maxRequestsPerIp, windowMs, now)
    
    if (ipResult.limited) {
      state.stats.totalBlocked++
      logger.debug(`IP rate limit exceeded for ${clientIp} (${ipBucket.count}/${maxRequestsPerIp})`)
      
      return buildRateLimitResponse(false, {
        ...ipResult,
        reason: 'ip',
        clientIp
      }, config)
    }
    results.push(ipResult)
  } else if (isIpv6(clientIp)) {
    // TODO: IPv6 support
    // For now, treat IPv6 like IPv4 (without normalization)
    // This may cause issues with same client using different IPv6 representations
    logger.debug(`IPv6 address detected: ${clientIp} (using basic tracking)`)
    
    const ipBucket = getOrCreateBucket(state.ipv4Buckets, clientIp, now)
    const ipResult = recordAndCheck(ipBucket, maxRequestsPerIp, windowMs, now)
    
    if (ipResult.limited) {
      state.stats.totalBlocked++
      return buildRateLimitResponse(false, {
        ...ipResult,
        reason: 'ip',
        clientIp
      }, config)
    }
    results.push(ipResult)
  }
  
  // 3. Check custom key rate limit (e.g., username for auth)
  if (customKeyFn) {
    try {
      const customKey = customKeyFn(payload, request)
      
      if (customKey) {
        const customBucket = getOrCreateBucket(state.customBuckets, customKey, now)
        const customResult = recordAndCheck(
          customBucket, 
          maxRequestsPerCustomKey, 
          windowMs, 
          now
        )
        
        if (customResult.limited) {
          state.stats.totalBlocked++
          logger.debug(`Custom key rate limit exceeded for "${customKey}" (${customBucket.count}/${maxRequestsPerCustomKey})`)
          
          return buildRateLimitResponse(false, {
            ...customResult,
            reason: 'custom',
            customKey,
            clientIp
          }, config)
        }
        results.push(customResult)
      }
    } catch (err) {
      // Don't fail the request if custom key extraction fails
      logger.warn('Custom rate limit key extraction failed:', err.message)
    }
  }
  
  // Calculate combined remaining (minimum across all checks)
  const minRemaining = results.length > 0 
    ? Math.min(...results.map(r => r.remaining))
    : maxRequestsPerIp
  const maxResetMs = results.length > 0
    ? Math.max(...results.map(r => r.resetMs))
    : windowMs
  
  return buildRateLimitResponse(true, {
    remaining: minRemaining,
    resetMs: maxResetMs,
    retryAfterMs: 0,
    clientIp
  }, config)
}

/**
 * Configure rate limiting for a specific service
 * 
 * @param {Object} state - Rate limiter state
 * @param {string} serviceName - Service name
 * @param {Object} config - Rate limit configuration
 */
export function setServiceRateLimit(state, serviceName, config) {
  const validatedConfig = validateConfig(config)
  state.serviceConfigs.set(serviceName, validatedConfig)
  logger.debug(`Rate limit configured for service "${serviceName}":`, validatedConfig)
}

/**
 * Configure default/global rate limiting
 * 
 * @param {Object} state - Rate limiter state
 * @param {Object} config - Rate limit configuration
 */
export function setDefaultRateLimit(state, config) {
  const validatedConfig = validateConfig(config)
  state.defaultConfig = validatedConfig
  logger.debug('Default rate limit configured:', validatedConfig)
}

/**
 * Remove rate limit configuration for a service
 * Falls back to default config
 * 
 * @param {Object} state - Rate limiter state
 * @param {string} serviceName - Service name
 */
export function removeServiceRateLimit(state, serviceName) {
  state.serviceConfigs.delete(serviceName)
  logger.debug(`Rate limit removed for service "${serviceName}"`)
}

/**
 * Clear all rate limit state (for testing or reset)
 * Does not clear configurations, only tracking data
 * 
 * @param {Object} state - Rate limiter state
 */
export function clearRateLimitTracking(state) {
  state.ipv4Buckets.clear()
  state.customBuckets.clear()
  state.globalCounter = {
    count: 0,
    windowStart: Date.now(),
    requests: []
  }
  state.stats.totalRequests = 0
  state.stats.totalBlocked = 0
  state.stats.lastCleanup = Date.now()
  logger.debug('Rate limit tracking cleared')
}

/**
 * Initialize rate limiter on an existing state object
 * Adds rateLimiter property if it doesn't exist
 * 
 * @param {Object} state - Gateway or registry state
 * @param {Object} defaultConfig - Default rate limit configuration (optional)
 * @returns {Object} Rate limiter state
 */
export function initializeRateLimiter(state, defaultConfig = null) {
  if (!state.rateLimiter) {
    state.rateLimiter = createRateLimiterState()
  }
  
  if (defaultConfig) {
    setDefaultRateLimit(state.rateLimiter, defaultConfig)
  }
  
  return state.rateLimiter
}
