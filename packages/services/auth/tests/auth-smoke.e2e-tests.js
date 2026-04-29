import { assert, terminateAfter } from '@yamf/test'
import { registryServer } from '@yamf/core'
import createAuthService from '../../service.js'

export async function testAuthServiceBootsE2E () {
  await terminateAfter(
    () => registryServer(),
    () => createAuthService({
      validateUserPassword: async () => false,
      ephemeral: true
    }),
    async (_, svc) => {
      await assert(svc.name === 'auth-service', x => x === true)
    }
  )
}
