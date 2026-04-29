import { assert } from '@yamf/test'
import { toCamelCase } from '@yamf/shared'

export const name = 'shared: toCamelCase'

export default async function run () {
  const o = toCamelCase({ user_name: 'x' })
  await assert(o && o.userName === 'x', x => x === true)
}
