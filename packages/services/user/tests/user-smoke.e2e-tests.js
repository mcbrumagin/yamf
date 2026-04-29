import { assert, terminateAfter } from '@yamf/test'
import { registryServer, callService } from '@yamf/core'
import createPostgreSqlService from '@yamf/services-postgres'
import createUserService from '../../service.js'

export async function testUserCreateGetE2E () {
  const url = process.env.YAMF_TEST_PSQL_URL
  if (!url) {
    console.warn('skip testUserCreateGetE2E: YAMF_TEST_PSQL_URL not set')
    return
  }
  const email = `e2e_${Date.now()}@example.com`
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
