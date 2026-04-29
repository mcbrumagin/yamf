import { assert } from '@yamf/test'

export const name = 'pm3: createPm3Service export'

export default async function run () {
  const mod = await import('./service.js')
  await assert(typeof mod.default, x => x === 'function')
}
