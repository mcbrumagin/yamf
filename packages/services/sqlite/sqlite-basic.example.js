import { registryServer, callService } from '@yamf/core'
import { assert, terminateAfter } from '@yamf/test'
import createSqliteService from './service.js'

export const name = 'sqlite: SELECT 1'

export default async function run () {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({
      sqliteConfig: ':memory:',
      schema: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY);'
    }),
    async () => {
      const rows = await callService('sqlite-service', {
        template: 'SELECT 1 as n',
        data: {}
      })
      await assert(Array.isArray(rows) && rows[0]?.n === 1, x => x === true)
    }
  )
}
