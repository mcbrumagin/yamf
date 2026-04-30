import { assert, terminateAfter } from '@yamf/test'
import { registryServer, gatewayServer, createService, callService } from '../../src/index.js'

export async function testCallPrivateServiceWithRegistryDefaults () {
  await terminateAfter(
    () => registryServer(),
    () => gatewayServer(),
    () => createService('private-echo', function (p) {
      return { echo: p }
    }, { accessControl: 'private' }),
    async () => {
      const r = await callService('private-echo', { x: 1 })
      await assert(r, x => x?.echo?.x === 1)
    }
  )
}
