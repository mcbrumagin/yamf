import { registryServer, callService } from '@yamf/core'
import { assert, terminateAfter } from '@yamf/test'
import createPostgreSqlService from './service.js'

export const name = 'postgres: ping'

export default async function run () {
  const url = process.env.YAMF_TEST_PSQL_URL
  if (!url) {
    console.warn('[postgres-basic.example] skip: set YAMF_TEST_PSQL_URL')
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
