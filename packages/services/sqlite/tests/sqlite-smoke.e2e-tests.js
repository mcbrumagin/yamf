import { assert, terminateAfter } from '@yamf/test'
import { registryServer, callService } from '@yamf/core'
import createSqliteService from '../../service.js'

export async function testSqliteSelectOneE2E () {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({
      sqliteConfig: ':memory:',
      schema: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY);'
    }),
    async () => {
      const rows = await callService('sqlite-service', {
        template: 'SELECT 1 as one',
        data: {}
      })
      await assert(rows?.[0]?.one === 1 || rows?.[0]?.one === '1', x => x === true)
    }
  )
}
