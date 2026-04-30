import { registryServer, callService } from '@yamf/core'
import createPostgreSqlService from '@yamf/services-postgres'
import createUserService from './service.js'

const psql = process.env.YAMF_TEST_PSQL_URL
if (!psql) {
  console.warn('[user-basic.example] Set YAMF_TEST_PSQL_URL for full demo; exiting 0 for local smoke.')
  process.exit(0)
}

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

const email = `ex_${Date.now()}@example.com`

await registryServer()
await createPostgreSqlService({ psqlConfig: psql })
await createUserService()

await callService('user-service', {
  create: { username: email, password: 'ExamplePass123!' }
})
const u = await callService('user-service', { get: { username: email } })
console.log('user:', u)
