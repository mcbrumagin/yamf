/**
 * Default security headers / CSP helpers (slice A)
 */
import { assert } from '@yamf/test'
import { getDefaultResponseSecurityHeaders, buildCsp } from '../../src/shared/csp.js'

export async function testDefaultSecurityHeadersIncludeBasics() {
  const h = getDefaultResponseSecurityHeaders({ csp: false })
  await assert(h, x => x['x-content-type-options'] === 'nosniff')
  await assert(h, x => x['x-frame-options'] === 'DENY')
  await assert(h, x => typeof x['referrer-policy'] === 'string')
}

export async function testBuildCspProducesHeader() {
  const { headerName, headerValue } = buildCsp({
    scriptSrc: ["'self'"],
    connectSrc: ["'self'", 'http://localhost:4000']
  })
  await assert(headerName, n => n === 'content-security-policy')
  await assert(headerValue, v => v.includes("default-src") && v.includes('connect-src'))
}
