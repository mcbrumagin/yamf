import { assert, terminateAfter } from '@yamf/test'
import { registryServer, callService } from '@yamf/core'
import createPostgreSqlService from '../../service.js'

export async function testPostgresSelectOneE2E () {
  const url = process.env.YAMF_TEST_PSQL_URL
  if (!url) {
    console.warn('skip testPostgresSelectOneE2E: YAMF_TEST_PSQL_URL not set')
    return
  }
  await terminateAfter(
    () => registryServer(),
    () => createPostgreSqlService({ psqlConfig: url }),
    async () => {
      const rows = await callService('postgres-service', {
        template: 'SELECT 1 as one',
        data: {}
      })
      await assert(Array.isArray(rows), x => x === true)
    }
  )
}
