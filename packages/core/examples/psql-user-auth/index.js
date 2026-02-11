import {
  registryServer,
  gatewayServer,
  createService,
  callService,
  HEADERS,
  COMMANDS,
  Logger,
  overrideConsoleGlobally
} from '@yamf/core'


import { checkArgonPassword } from '@yamf/core/crypto'

import createAuthService from '@yamf/services-auth'
import createPostgreSqlService from '@yamf/services-postgres'
import createUserService from '@yamf/services-user'

const logger = new Logger()
overrideConsoleGlobally({ includeLogLineNumbers: true })

async function main() {
  /**
   * Validate user credentials for auth service
   * Checks: password matches, user is active, registered, and verified
   */
  async function validateUserPassword(username, password) {
    try {
      console.warn('validateUserPassword', { username })
      let [user] = await callService('postgres-service', {
        template: `SELECT salt, hash, is_active, is_registered, is_verified FROM yamf.user WHERE username = :username`,
        data: { username }
      })

      if (!user) {
        console.warn('User not found:', username)
        return false
      }

      const { salt, hash, isActive, isRegistered, isVerified } = user

      // Check user state
      if (!isActive) {
        console.warn('User not active:', username)
        return false
      }
      if (!isRegistered) {
        console.warn('User not registered:', username)
        return false
      }
      if (!isVerified) {
        console.warn('User not verified:', username)
        return false
      }

      console.warn('Checking password for:', username)
      return await checkArgonPassword(password, salt, hash)
    } catch (err) {
      console.error('validateUserPassword error:', err)
      return false
    }
  }

  // ==========================================================================
  // Initialize services
  // ==========================================================================

  let services = [
    await registryServer(),
    await gatewayServer(),
    await createAuthService({ validateUserPassword }),
    await createPostgreSqlService({
      psqlConfig: 'postgres://yamf:changeme@localhost/yamf'
    }),
    await createUserService()
  ]

  // ==========================================================================
  // Demo: Self-signup flow (user creates account with password)
  // ==========================================================================

  console.log('\n=== DEMO: Self-Signup Flow ===\n')

  // Clean up previous test user
  await callService('user-service', {
    remove: { username: 'self-signup@test.com' }
  })

  // Self-signup: create with password
  // Results in: is_registered=true, is_verified=false, is_active=false
  let selfSignup = await callService('user-service', {
    create: {
      username: 'self-signup@test.com',
      password: 'testtest',
    }
  })
  console.log('Self-signup created:', selfSignup)

  // Get the user to see initial state
  let { get: selfSignupUser } = await callService('user-service', {
    get: { username: 'self-signup@test.com' }
  })
  console.log('Self-signup user state:', selfSignupUser)
  // isRegistered: true, isVerified: false, isActive: false

  // Verify the user (simulates clicking email verification link)
  let verifyResult = await callService('user-service', {
    verify: { userId: selfSignupUser.userId }
  })
  console.log('Verified user:', verifyResult)

  // Activate the user
  await callService('user-service', {
    update: { userId: selfSignupUser.userId, isActive: true }
  })

  // Final state
  let { get: verifiedUser } = await callService('user-service', {
    get: { userId: selfSignupUser.userId }
  })
  console.log('Final self-signup user:', verifiedUser)
  // isRegistered: true, isVerified: true, isActive: true

  // ==========================================================================
  // Demo: Admin-invite flow (admin creates account, user registers with token)
  // ==========================================================================

  console.log('\n=== DEMO: Admin-Invite Flow ===\n')

  // Clean up previous test user
  await callService('user-service', {
    remove: { username: 'invited@test.com' }
  })

  // Admin creates user WITHOUT password
  // Results in: is_registered=false, is_verified=false, token returned
  let adminCreate = await callService('user-service', {
    create: {
      username: 'invited@test.com',
      isActive: true,  // Admin pre-activates the account
      // No password = generates registration token
    }
  })
  console.log('Admin created user:', adminCreate)
  const inviteToken = adminCreate.create.token
  console.log('Registration token (send to user):', inviteToken)

  // Get the user to see initial state
  let { get: invitedUser } = await callService('user-service', {
    get: { username: 'invited@test.com' }
  })
  console.log('Invited user state:', invitedUser)
  // isRegistered: false, isVerified: false, isActive: true

  // User registers with token and sets their password
  let registerResult = await callService('user-service', {
    register: {
      token: inviteToken,
      password: 'mypassword123',
    }
  })
  console.log('Registered with token:', registerResult)

  // Final state
  let { get: registeredUser } = await callService('user-service', {
    get: { username: 'invited@test.com' }
  })
  console.log('Final invited user:', registeredUser)
  // isRegistered: true, isVerified: true, isActive: true

  // ==========================================================================
  // Demo: Authentication
  // ==========================================================================

  console.log('\n=== DEMO: Authentication ===\n')

  // Create a test service that requires authentication
  await createService('test-service', async function testService(payload) {
    return { ...payload, result: 'authenticated!' }
  }, {
    accessControl: 'public',
    useAuthService: 'auth-service'
  })

  // Authenticate with self-signup user
  let authResult = await callService('auth-service', {
    body: { authenticate: { user: 'self-signup@test.com', password: 'testtest' } },
    headers: {
      [HEADERS.COMMAND]: COMMANDS.AUTH_LOGIN
    }
  })
  console.log('Auth result:', authResult)

  // Use token to call authenticated service
  let testResult = await callService('test-service', {
    body: { message: 'Hello from authenticated user!' },
    headers: {
      [HEADERS.AUTH_TOKEN]: authResult.accessToken
    }
  })
  console.log('Test service result:', testResult)

  // ==========================================================================
  // Demo: Generate new token (admin re-sends invite)
  // ==========================================================================

  console.log('\n=== DEMO: Re-generate Token ===\n')

  // Clean up and create a new unregistered user
  await callService('user-service', {
    remove: { username: 'resend@test.com' }
  })

  let newUser = await callService('user-service', {
    create: { username: 'resend@test.com' }
  })
  console.log('Created user for token resend:', newUser)

  // Generate a new token (e.g., user lost the first one)
  let newTokenResult = await callService('user-service', {
    createToken: {
      userId: newUser.create.userId,
      expiresIn: 24 * 60 * 60 * 1000,  // 24 hours
    }
  })
  console.log('New token generated:', newTokenResult)

  // ==========================================================================

  console.log('\n=== All demos complete! Server running... ===\n')

  process.once('SIGINT', async () => {
    try {
      for (let service of services.reverse()) {
        await service?.terminate()
      }
    } catch (err) {
      console.error(err)
    }
    process.exit(0)
  })
}

main().then(() => {
  console.log('Ready!')
}).catch(err => console.error(err))
