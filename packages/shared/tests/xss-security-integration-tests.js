import { assert } from '@yamf/test'
import { sanitizeHtml } from '../src/security/xss.js'

/** Pure helper coverage; lives in integration bucket (not e2e — no process boundary). */
export async function testSanitizeHtmlStripsScript () {
  const out = sanitizeHtml('<img src=x onerror=alert(1)>')
  await assert(
    out,
    (r) => r.includes('&lt;img'),
    (r) => !r.includes('<img'),
    (r) => !r.includes('<script')
  )
}
