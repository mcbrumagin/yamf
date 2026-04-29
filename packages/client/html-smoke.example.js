import { assert } from '@yamf/test'
import { encode } from '@yamf/client'

export const name = 'client: shared XSS encode re-export'

export default async function run () {
  await assert(
    encode && typeof encode.html === 'function' && typeof encode.attr === 'function',
    x => x === true
  )
}
