import { assert } from '@yamf/test'

export const name = 'dev-hmr: factory export'

export default async function run () {
  const mod = await import('./service.js')
  await assert(typeof mod.default, x => x === 'function')
}
