import { registryServer, callService } from '@yamf/core'
import createSqliteService from './service.js'

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

await registryServer()
await createSqliteService({
  sqliteConfig: ':memory:',
  schema: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY);'
})

const rows = await callService('sqlite', {
  template: 'SELECT 1 as n',
  data: {}
})
console.log('sqlite sample:', rows)
