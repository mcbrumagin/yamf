import { assert, terminateAfter } from '@yamf/test'
import { registryServer, callService } from '@yamf/core'
import createPostgresService from '@yamf/services-postgres'
import createUserService from '../service.js'

export async function testUserCreateGetE2E () {
  const url =
    process.env.YAMF_TEST_POSTGRES_URL ||
    process.env.YAMF_TEST_PSQL_URL ||
    process.env.TEST_PSQL_URL
  if (!url) {
    console.warn('skip testUserCreateGetE2E: YAMF_TEST_POSTGRES_URL not set')
    return
  }
  const email = `e2e_${Date.now()}@example.com`
  await terminateAfter(async function userSmokeBody () {
    await registryServer()
    await createPostgresService({ psqlConfig: url })
    await createUserService({})
    await callService('user-service', {
      create: { username: email, password: 'ExamplePass123!' }
    })
    const created = await callService('user-service', { get: { username: email } })
    await assert(created?.get, (g) => g.username === email)

    const inviteEmail = `e2e_inv_${Date.now()}@example.com`
    const inv = await callService('user-service', {
      invite: { username: inviteEmail, isActive: true }
    })
    await assert(inv?.invite, (i) => i.isRegistered === false && typeof i.token === 'string')

    const reg = await callService('user-service', {
      register: {
        token: inv.invite.token,
        password: 'ExamplePass123!'
      }
    })
    await assert(reg?.register, (r) => r.isRegistered === true && r.isVerified === true)

    const got = await callService('user-service', { get: { username: inviteEmail } })
    await assert(got?.get, (g) => g.username === inviteEmail && g.isVerified === true)
  })
}
