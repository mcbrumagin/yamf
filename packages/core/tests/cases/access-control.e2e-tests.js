import { assert, terminateAfter } from '@yamf/test'
import { registryServer, gatewayServer, createService, callService } from '../../src/index.js'

export async function testCallPrivateServiceWithRegistryDefaults () {
  await terminateAfter(
    () => registryServer(),
    () => gatewayServer(),
    () => createService(function privateEcho (p) {
      return { echo: p }
    }, { accessControl: 'private' }),
    async () => {
      const r = await callService('privateEcho', { x: 1 })
      await assert(r && r.echo && r.echo.x === 1, x => x === true)
    }
  )
}
