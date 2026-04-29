import { registryServer, callService } from '@yamf/core'
import { assert, terminateAfter } from '@yamf/test'
import createPostgreSqlService from '@yamf/services-postgres'
import createUserService from './service.js'

export const name = 'user: create + get'

export default async function run () {
  const url = process.env.YAMF_TEST_PSQL_URL
  if (!url) {
    console.warn('[user-basic.example] skip: set YAMF_TEST_PSQL_URL')
    return
  }
  const email = `ex_${Date.now()}@example.com`
  await terminateAfter(
    () => registryServer(),
    () => createPostgreSqlService({ psqlConfig: url }),
    () => createUserService({}),
    async () => {
      await callService('user-service', {
        create: { username: email, password: 'ExamplePass123!' }
      })
      const u = await callService('user-service', { get: { username: email } })
      await assert(u && u.username === email, x => x === true)
    }
  )
}
