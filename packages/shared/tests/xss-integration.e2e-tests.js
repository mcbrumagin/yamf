import { assert } from '@yamf/test'
import { sanitizeHtml } from '../src/security/xss.js'

export async function testSanitizeHtmlStripsScript () {
  const out = sanitizeHtml('<img src=x onerror=alert(1)>')
  await assert(
    out,
    (r) => r.includes('&lt;img'),
    (r) => !r.includes('<img'),
    (r) => !r.includes('<script')
  )
}
