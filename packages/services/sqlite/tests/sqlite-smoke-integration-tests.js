import { assert, terminateAfter } from '@yamf/test'
import { registryServer, callService } from '@yamf/core'
import createSqliteService from '../service.js'

/** In-memory SQLite + registry; integration tier (not cross-process e2e). */
export async function testSqliteSelectOneIntegration () {
  await terminateAfter(async function sqliteSmokeBody () {
    await registryServer()
    await createSqliteService({
      sqliteConfig: ':memory:',
      schema: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY);'
    })
    const rows = await callService('sqlite', {
      template: 'SELECT 1 as one',
      data: {}
    })
    await assert(rows, (r) => r?.[0]?.one === 1 || r?.[0]?.one === '1')
  })
}
