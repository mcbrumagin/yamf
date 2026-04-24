/**
 * Rate Limiter Module
 * 
 * Rate limiting is configured via server options, not directly via these exports.
 * 
 * @example
 * // Configure rate limiting on registry
 * await registryServer({
 *   port: 8080,
 *   rateLimit: {
 *     default: { windowMs: 60000, maxRequestsPerIp: 100, maxTotalRequests: 10000 },
 *     services: {
 *       'auth-service': { windowMs: 60000, maxRequestsPerIp: 10, customKeyFn: (p) => p?.username }
 *     }
 *   }
 * })
 * 
 * @example
 * // Require rate limit config on service
 * await createService('auth-service', handler, { rateLimit: true })
 */

// Configuration presets (for reference/convenience)
export {
  DEFAULT_RATE_LIMIT_CONFIG,
  AUTH_RATE_LIMIT_CONFIG,
  PUBLIC_RATE_LIMIT_CONFIG,
  createAuthKeyFn,
  createApiKeyFn
} from './rate-limiter-config.js'

// Note: Internal functions like setServiceRateLimit, setDefaultRateLimit, clearRateLimitTracking
// are no longer exported. Rate limiting is configured via registryServer/gatewayServer options.
