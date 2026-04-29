import { join } from 'node:path'
import { registryServer, callService } from '@yamf/core'
import { assert, terminateAfter, withEnv } from '@yamf/test'
import createConfigService from './service.js'

export const name = 'config: list entries'

export default async function run () {
  await withEnv({
    YAMF_CONFIG_KEY: 'example-config-passphrase-for-tests-only-32b!',
    YAMF_CONFIG_ADMIN_TOKEN: 'example-token-for-local-examples'
  }, async () => {
    await terminateAfter(
      () => registryServer(),
      () => createConfigService({
        adminToken: 'example-token-for-local-examples',
        dataDir: join(process.cwd(), '.yamf-example-config-data')
      }),
      async () => {
        const r = await callService('config-service', { command: 'list' })
        await assert(r && Array.isArray(r.entries), x => x === true)
      }
    )
  })
}
