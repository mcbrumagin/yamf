import { registryServer, callService } from '@yamf/core'
import createPostgresService from './service.js'

const url =
  process.env.YAMF_TEST_POSTGRES_URL ||
  process.env.YAMF_TEST_PSQL_URL ||
  process.env.TEST_PSQL_URL
if (!url) {
  console.warn('[postgres-basic.example] Set YAMF_TEST_POSTGRES_URL to run against Postgres; exiting 0 for local smoke.')
  process.exit(0)
}

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

await registryServer()
await createPostgresService({ psqlConfig: url })

const rows = await callService('postgres', {
  template: 'SELECT 1 as one',
  data: {}
})
console.log('SELECT 1:', rows)
