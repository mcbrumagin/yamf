import { assert } from '@yamf/test'

export const name = 'deploy-router: attachDeployRouter export'

export default async function run () {
  const { attachDeployRouter } = await import('./service.js')
  await assert(typeof attachDeployRouter, x => x === 'function')
}
