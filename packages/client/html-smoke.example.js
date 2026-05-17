/**
 * Sanity check: `@yamf/client` re-exports shared HTML encode helpers.
 */
import { encode } from '@yamf/client'

if (typeof encode?.html !== 'function' || typeof encode?.attr !== 'function') {
  console.error('encode.html / encode.attr must be functions')
  process.exit(1)
}
console.log('@yamf/client encode re-export ok')
