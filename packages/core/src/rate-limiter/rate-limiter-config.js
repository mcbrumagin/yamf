/**
 * Rate Limiter Configuration
 * Defines default configuration and validation for rate limiting
 */

/**
 * Default rate limit configuration
 * Applied when no service-specific or custom config is provided
 * 
 * @type {RateLimitConfig}
 */
export const DEFAULT_RATE_LIMIT_CONFIG = {
  // Time window in milliseconds (default: 1 minute)
  windowMs: 10000,
  
  // Maximum requests per IP address in the window
  maxRequestsPerIp: 100,
  
  // Maximum total requests across all IPs in the window
  // Protects against distributed brute force attacks
  maxTotalRequests: 10000,
  
  // Maximum requests per custom key (e.g., username)
  // Only applies when customKeyFn is provided
  maxRequestsPerCustomKey: 10,
  
  // Custom key extraction function (optional)
  // Signature: (payload, request) => string | null
  // Return null to skip custom key tracking
  customKeyFn: null
}

/**
 * Strict rate limit config for auth services
 * More restrictive to prevent credential stuffing
 */
export const AUTH_RATE_LIMIT_CONFIG = {
  windowMs: 60000,           // 1 minute
  maxRequestsPerIp: 20,      // 20 attempts per IP
  maxTotalRequests: 5000,    // Lower global threshold
  maxRequestsPerCustomKey: 5, // 5 attempts per username
  
  // Default custom key for auth: extract username/email from payload
  customKeyFn: (payload) => {
    if (!payload || typeof payload !== 'object') return null
    return payload.username || payload.email || payload.user || null
  }
}

/**
 * Relaxed rate limit config for public APIs
 * Higher limits for general use
 */
export const PUBLIC_RATE_LIMIT_CONFIG = {
  windowMs: 60000,
  maxRequestsPerIp: 200,
  maxTotalRequests: 50000,
  maxRequestsPerCustomKey: 50,
  customKeyFn: null
}

/**
 * Validate a rate limit configuration
 * Ensures all values are within acceptable ranges
 * 
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validated configuration (with defaults for missing values)
 * @throws {Error} If configuration is invalid
 */
export function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Rate limit config must be an object')
  }
  
  const validated = { ...DEFAULT_RATE_LIMIT_CONFIG }
  
  // Validate windowMs
  if (config.windowMs !== undefined) {
    if (typeof config.windowMs !== 'number' || config.windowMs < 1000) {
      throw new Error('windowMs must be a number >= 1000 (1 second)')
    }
    if (config.windowMs > 86400000) {
      throw new Error('windowMs must be <= 86400000 (24 hours)')
    }
    validated.windowMs = config.windowMs
  }
  
  // Validate maxRequestsPerIp
  if (config.maxRequestsPerIp !== undefined) {
    if (typeof config.maxRequestsPerIp !== 'number' || config.maxRequestsPerIp < 1) {
      throw new Error('maxRequestsPerIp must be a number >= 1')
    }
    validated.maxRequestsPerIp = config.maxRequestsPerIp
  }
  
  // Validate maxTotalRequests
  if (config.maxTotalRequests !== undefined) {
    if (typeof config.maxTotalRequests !== 'number' || config.maxTotalRequests < 1) {
      throw new Error('maxTotalRequests must be a number >= 1')
    }
    validated.maxTotalRequests = config.maxTotalRequests
  }
  
  // Validate maxRequestsPerCustomKey
  if (config.maxRequestsPerCustomKey !== undefined) {
    if (typeof config.maxRequestsPerCustomKey !== 'number' || config.maxRequestsPerCustomKey < 1) {
      throw new Error('maxRequestsPerCustomKey must be a number >= 1')
    }
    validated.maxRequestsPerCustomKey = config.maxRequestsPerCustomKey
  }
  
  // Validate customKeyFn
  if (config.customKeyFn !== undefined) {
    if (config.customKeyFn !== null && typeof config.customKeyFn !== 'function') {
      throw new Error('customKeyFn must be a function or null')
    }
    validated.customKeyFn = config.customKeyFn
  }
  
  // Sanity check: maxTotalRequests should be >= maxRequestsPerIp
  if (validated.maxTotalRequests < validated.maxRequestsPerIp) {
    throw new Error('maxTotalRequests should be >= maxRequestsPerIp')
  }
  
  return validated
}

/**
 * Merge two rate limit configurations
 * Later config values override earlier ones
 * 
 * @param {Object} baseConfig - Base configuration
 * @param {Object} overrideConfig - Override configuration
 * @returns {Object} Merged configuration
 */
export function mergeConfig(baseConfig, overrideConfig) {
  if (!overrideConfig) return baseConfig
  
  return {
    windowMs: overrideConfig.windowMs ?? baseConfig.windowMs,
    maxRequestsPerIp: overrideConfig.maxRequestsPerIp ?? baseConfig.maxRequestsPerIp,
    maxTotalRequests: overrideConfig.maxTotalRequests ?? baseConfig.maxTotalRequests,
    maxRequestsPerCustomKey: overrideConfig.maxRequestsPerCustomKey ?? baseConfig.maxRequestsPerCustomKey,
    customKeyFn: overrideConfig.customKeyFn !== undefined ? overrideConfig.customKeyFn : baseConfig.customKeyFn
  }
}

/**
 * Create a custom key function for auth rate limiting
 * Extracts username/email from common payload patterns
 * 
 * @param {string[]} fields - Fields to check in order (default: ['username', 'email', 'user'])
 * @returns {Function} Custom key extraction function
 */
export function createAuthKeyFn(fields = ['username', 'email', 'user']) {
  return (payload) => {
    if (!payload || typeof payload !== 'object') return null
    
    for (const field of fields) {
      if (payload[field] && typeof payload[field] === 'string') {
        return payload[field].toLowerCase() // Normalize to lowercase
      }
    }
    
    return null
  }
}

/**
 * Create a custom key function for API key rate limiting
 * Extracts API key from headers or payload
 * 
 * @param {string} headerName - Header to check (default: 'x-api-key')
 * @param {string} payloadField - Payload field to check (default: 'apiKey')
 * @returns {Function} Custom key extraction function
 */
export function createApiKeyFn(headerName = 'x-api-key', payloadField = 'apiKey') {
  return (payload, request) => {
    // Check header first
    const headerValue = request?.headers?.[headerName.toLowerCase()]
    if (headerValue) return headerValue
    
    // Fall back to payload
    if (payload && typeof payload === 'object' && payload[payloadField]) {
      return payload[payloadField]
    }
    
    return null
  }
}

/**
 * Serialize rate limit config for transmission (e.g., in headers)
 * Excludes functions which cannot be serialized
 * 
 * @param {Object} config - Rate limit configuration
 * @returns {Object} Serializable configuration
 */
export function serializeConfig(config) {
  return {
    windowMs: config.windowMs,
    maxRequestsPerIp: config.maxRequestsPerIp,
    maxTotalRequests: config.maxTotalRequests,
    maxRequestsPerCustomKey: config.maxRequestsPerCustomKey,
    // Note: customKeyFn cannot be serialized
    hasCustomKeyFn: config.customKeyFn !== null
  }
}

/**
 * Deserialize rate limit config from transmission
 * 
 * @param {Object} serialized - Serialized configuration
 * @returns {Object} Configuration object (without customKeyFn)
 */
export function deserializeConfig(serialized) {
  if (!serialized || typeof serialized !== 'object') {
    return null
  }
  
  return {
    windowMs: serialized.windowMs,
    maxRequestsPerIp: serialized.maxRequestsPerIp,
    maxTotalRequests: serialized.maxTotalRequests,
    maxRequestsPerCustomKey: serialized.maxRequestsPerCustomKey,
    customKeyFn: null // Cannot deserialize functions
  }
}
