import { registryServer, createService, callService } from '@yamf/core'
import { assert, terminateAfter } from '@yamf/test'

export const name = 'core: echo service via registry'

export default async function run () {
  await terminateAfter(
    () => registryServer(),
    () => createService(function exampleEcho (p) {
      return { ok: true, p }
    }),
    async () => {
      const r = await callService('exampleEcho', { n: 42 })
      await assert(r && r.ok && r.p && r.p.n === 42, x => x === true)
    }
  )
}
