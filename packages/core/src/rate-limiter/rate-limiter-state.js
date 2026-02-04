/**
 * Rate Limiter State Management
 * Manages in-memory state for tracking request rates
 * 
 * Supports:
 * - Per-IPv4 address tracking
 * - Global request counter (brute force protection)
 * - Custom key buckets (e.g., username for auth)
 * - Service-specific configurations
 * 
 * TODO: IPv6 support - needs address normalization
 * TODO: CIDR block rate limiting - needs trie structure for efficient matching
 */

/**
 * Create rate limiter state
 * Each gateway/registry instance has its own rate limiter state (not synced)
 * 
 * @returns {Object} Rate limiter state object
 */
export function createRateLimiterState() {
  return {
    // IPv4 address -> RequestBucket
    // RequestBucket: { count, windowStart, requests: [timestamps] }
    ipv4Buckets: new Map(),
    
    // TODO: IPv6 support
    // IPv6 addresses need normalization before tracking:
    // - ::1 and 0:0:0:0:0:0:0:1 are the same
    // - Handle IPv4-mapped IPv6 (::ffff:192.168.1.1)
    // ipv6Buckets: new Map(),
    
    // TODO: CIDR block tracking
    // For rate limiting by subnet (e.g., 192.168.1.0/24)
    // Consider using a trie structure for efficient matching
    // cidrBuckets: new Map(),
    // cidrTrie: null, // For efficient CIDR matching
    
    // Custom key buckets (e.g., username for auth)
    // key -> RequestBucket
    customBuckets: new Map(),
    
    // Global request counter (across all IPs)
    // Used to protect against distributed brute force attacks
    globalCounter: {
      count: 0,
      windowStart: Date.now(),
      requests: []  // timestamps for sliding window
    },
    
    // Service-specific rate limit configs
    // serviceName -> RateLimitConfig
    serviceConfigs: new Map(),
    
    // Default/global rate limit config (applied when no service-specific config)
    defaultConfig: null,
    
    // Statistics for monitoring (optional)
    stats: {
      totalRequests: 0,
      totalBlocked: 0,
      lastCleanup: Date.now()
    }
  }
}

/**
 * Reset rate limiter state
 * Useful for testing or manual reset
 * 
 * @param {Object} state - Rate limiter state to reset
 */
export function resetRateLimiterState(state) {
  state.ipv4Buckets.clear()
  state.customBuckets.clear()
  state.globalCounter = {
    count: 0,
    windowStart: Date.now(),
    requests: []
  }
  state.serviceConfigs.clear()
  state.defaultConfig = null
  state.stats = {
    totalRequests: 0,
    totalBlocked: 0,
    lastCleanup: Date.now()
  }
}

/**
 * Create a new request bucket
 * 
 * @param {number} now - Current timestamp
 * @returns {Object} New request bucket
 */
export function createBucket(now = Date.now()) {
  return {
    count: 0,
    windowStart: now,
    requests: []
  }
}

/**
 * Get or create a bucket for a given key
 * 
 * @param {Map} bucketMap - Map of buckets
 * @param {string} key - Bucket key (IP, custom key, etc.)
 * @param {number} now - Current timestamp
 * @returns {Object} Request bucket
 */
export function getOrCreateBucket(bucketMap, key, now = Date.now()) {
  if (!bucketMap.has(key)) {
    bucketMap.set(key, createBucket(now))
  }
  return bucketMap.get(key)
}

/**
 * Clean expired entries from a bucket map
 * Removes requests outside the window and deletes empty buckets
 * 
 * @param {Map} bucketMap - Map of buckets to clean
 * @param {number} windowMs - Window size in milliseconds
 * @param {number} now - Current timestamp
 * @returns {number} Number of buckets removed
 */
export function cleanExpiredEntries(bucketMap, windowMs, now = Date.now()) {
  let removed = 0
  
  for (const [key, bucket] of bucketMap) {
    // Filter requests within the window
    bucket.requests = bucket.requests.filter(ts => now - ts < windowMs)
    bucket.count = bucket.requests.length
    
    // Remove empty buckets to prevent memory leaks
    if (bucket.count === 0) {
      bucketMap.delete(key)
      removed++
    }
  }
  
  return removed
}

/**
 * Get statistics about rate limiter state
 * 
 * @param {Object} state - Rate limiter state
 * @returns {Object} Statistics object
 */
export function getRateLimiterStats(state) {
  return {
    ipv4BucketCount: state.ipv4Buckets.size,
    customBucketCount: state.customBuckets.size,
    globalRequestCount: state.globalCounter.count,
    serviceConfigCount: state.serviceConfigs.size,
    hasDefaultConfig: state.defaultConfig !== null,
    ...state.stats
  }
}
