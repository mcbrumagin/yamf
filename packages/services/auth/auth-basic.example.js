import { registryServer } from '@yamf/core'
import { assert, terminateAfter, withEnv, pickListenPort } from '@yamf/test'
import createAuthService from './service.js'

export const name = 'auth: service boots'

export default async function run () {
  const port = await pickListenPort()
  await withEnv(
    { YAMF_REGISTRY_URL: `http://127.0.0.1:${port}` },
    async () => {
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
  )
}
