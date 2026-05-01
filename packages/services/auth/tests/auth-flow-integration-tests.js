/**
 * Auth lifecycle integration (replaces trivial e2e smoke): authenticate → verifyAccess → logout.
 * Uses full session mode so logout clears server-side access state and verifyAccess fails afterward.
 */

import { assert, assertErr, terminateAfter } from '@yamf/test'
import { registryServer, callService, envConfig } from '@yamf/core'
import createAuthService from '../service.js'

const adminUser = envConfig.getRequired('ADMIN_USER')
const adminPass = envConfig.getRequired('ADMIN_PASS')
const fixtureValidate = async (user, pass) => user === adminUser && pass === adminPass

export async function testAuthAuthenticateVerifyLogoutFlow () {
  await terminateAfter(async () => {
    await registryServer()
    await createAuthService({
      validateUserPassword: fixtureValidate,
      useSessions: true
    })

    const authResult = await callService('auth', {
      authenticate: { user: adminUser, password: adminPass }
    })

    await assert(authResult, (r) => typeof r.accessToken === 'string' && r.accessToken.length > 0)

    const verifyResult = await callService('auth', {
      verifyAccess: authResult.accessToken
    })

    await assert(verifyResult, (r) => r.status === 'valid access token')

    const logoutResult = await callService('auth',
      { logout: {} },
      { authToken: authResult.accessToken }
    )

    await assert(logoutResult, (r) => r.success === true)
    await assertErr(async () =>
      callService('auth', {
        verifyAccess: authResult.accessToken
      }),
    (err) => err.status === 401)
  })
}
