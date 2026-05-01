/**
 * Content-Security-Policy and default security headers (slice A)
 */
import envConfig, { envTruthy } from './env-config.js'

function cspMode() {
  const m = envConfig.get('YAMF_CSP_MODE', null)
  // parseValue maps string "off" to boolean false — normalize back to mode token
  if (m === false) return 'off'
  if (m === 'off' || m === 'strict' || m === 'relaxed') return m
  const env = String(envConfig.get('ENVIRONMENT', 'dev')).toLowerCase()
  if (env.includes('prod')) return 'strict'
  return 'relaxed'
}

function originListForConnect() {
  const o = new Set()
  const reg = envConfig.get('YAMF_REGISTRY_URL', '')
  const gw = envConfig.get('YAMF_GATEWAY_URL', '')
  for (const u of [reg, gw]) {
    if (!u || typeof u !== 'string') continue
    try {
      const { protocol, host } = new URL(u)
      o.add(`${protocol}//${host}`)
    } catch {
      // ignore
    }
  }
  return [...o, "'self'"]
}

/**
 * Build a Content-Security-Policy header value.
 * @param {object} [opts]
 */
export function buildCsp({
  defaultSrc = ["'self'"],
  scriptSrc,
  styleSrc = ["'self'"],
  connectSrc = null,
  imgSrc = ["'self'", 'data:', 'blob:'],
  mediaSrc = ["'self'", 'blob:'],
  frameAncestors = ["'none'"],
  baseUri = ["'self'"],
  formAction = ["'self'"],
  reportTo = null,
  reportOnly = false
} = {}) {
  const connect = connectSrc == null ? originListForConnect() : connectSrc
  const reportUri = envConfig.get('YAMF_CSP_REPORT_URI', null)
  const parts = [
    `default-src ${(defaultSrc || ["'self'"]).join(' ')}`,
    `base-uri ${(baseUri || ["'self'"]).join(' ')}`,
    `frame-ancestors ${(frameAncestors || ["'none'"]).join(' ')}`,
    `form-action ${(formAction || ["'self'"]).join(' ')}`,
    `img-src ${(imgSrc || ["'self'"]).join(' ')}`,
    `media-src ${(mediaSrc || ["'self'"]).join(' ')}`,
    `connect-src ${connect.join(' ')}`
  ]
  if (scriptSrc && scriptSrc.length) {
    parts.push(`script-src ${scriptSrc.join(' ')}`)
  }
  if (styleSrc && styleSrc.length) {
    parts.push(`style-src ${styleSrc.join(' ')}`)
  }
  if (reportTo) {
    parts.push(`report-to ${reportTo}`)
  }
  if (reportUri) {
    parts.push(`report-uri ${reportUri}`)
  }
  return {
    headerName: reportOnly ? 'content-security-policy-report-only' : 'content-security-policy',
    headerValue: parts.join('; ')
  }
}

/**
 * Default headers merged onto JSON/HTML responses from {@link createServer} (http-server).
 * @param {object} [opts]
 * @param {object|false|null} [opts.csp] — null/undefined: auto; false: no CSP; object: merge into buildCsp
 * @param {string} [opts.frameOptions] — override `X-Frame-Options` (e.g. `SAMEORIGIN`)
 */
export function getDefaultResponseSecurityHeaders(opts = {}) {
  const h = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': opts.frameOptions != null ? opts.frameOptions : 'DENY',
    'x-xss-protection': '1; mode=block',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'interest-cohort=(), browsing-topics=()'
  }
  if (envTruthy(envConfig.get('YAMF_HSTS', false))) {
    h['strict-transport-security'] = 'max-age=31536000'
  }
  if (opts.csp === false) {
    return h
  }
  const mode = cspMode()
  if (mode === 'off') {
    return h
  }
  const relaxed =
    envTruthy(envConfig.get('YAMF_CSP_RELAXED', false)) || mode === 'relaxed'
  // Relaxed mode: unsafe-inline for script only (per roadmap); styles stay strict — override via opts.csp.styleSrc if needed for dev.
  const script = relaxed
    ? ["'self'", "'unsafe-inline'"]
    : ["'self'"]
  const merge = typeof opts.csp === 'object' && opts.csp != null ? opts.csp : {}
  const { headerName, headerValue } = buildCsp({
    scriptSrc: merge.scriptSrc || script,
    styleSrc: merge.styleSrc || ["'self'"],
    connectSrc: merge.connectSrc,
    defaultSrc: merge.defaultSrc,
    ...merge
  })
  h[headerName] = headerValue
  return h
}
