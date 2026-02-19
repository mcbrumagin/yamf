/**
 * User Service Integration Tests
 * 
 * These tests require a running PostgreSQL database.
 * Configure via PGDATABASE, PGUSER, PGPASSWORD environment variables.
 * 
 * Run: PGDATABASE=yamf_test PGUSER=yamf PGPASSWORD=changeme node tests/run-integration.js
 */

import {
  assert,
  assertErr,
  terminateAfter,
  withEnv
} from '@yamf/test'

import {
  registryServer,
  gatewayServer,
  callService,
  HttpError,
  overrideConsoleGlobally
} from '@yamf/core'

import createPostgreSqlService from '@yamf/services-postgres'
import createUserService from '../service.js'


// overrideConsoleGlobally({
//   includeLogLineNumbers: true
// })

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_PSQL_CONFIG = process.env.TEST_PSQL_URL || 
  `postgres://${process.env.PGUSER || 'yamf'}:${process.env.PGPASSWORD || 'changeme'}@localhost/${process.env.PGDATABASE || 'yamf'}`

// Unique test user prefix to avoid conflicts
const TEST_PREFIX = `test__integration__`

/**
 * Helper to create test username
 */
function testUsername(suffix) {
  return `${TEST_PREFIX}${suffix}@test.com`
}

/**
 * Cleanup helper - remove test users
 */
async function cleanupTestUsers(prefix) {
  try {
    await callService('postgres-service', {
      template: `DELETE FROM yamf.user WHERE username LIKE :pattern`,
      data: { pattern: `${prefix}%` }
    })
  } catch (err) {
    console.warn('Cleanup warning:', err.message)
  }
}

// =============================================================================
// PostgreSQL Service Tests
// =============================================================================

export async function testPostgresService_BasicQuery() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: 'SELECT 1 + 1 AS sum',
        data: {}
      })
      
      await assert(result,
        r => Array.isArray(r),
        r => r.length === 1,
        r => r[0].sum === 2
      )
    }
  )
}

export async function testPostgresService_ParameterizedQuery() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: 'SELECT :a::integer + :b::integer AS sum',
        data: { a: 5, b: 3 }
      })
      
      await assert(result,
        r => r[0].sum === 8
      )
    }
  )
}

export async function testPostgresService_CaseMapping() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      // Query with snake_case column names
      const result = await callService('postgres-service', {
        template: `SELECT 'test' AS my_column_name, 123 AS another_value`,
        data: {}
      })
      
      // Result should have camelCase keys
      await assert(result,
        r => r[0].myColumnName === 'test',
        r => r[0].anotherValue === 123
      )
    }
  )
}

export async function testPostgresService_InvalidPlaceholder() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('postgres-service', {
          template: 'SELECT :missingParam AS value',
          data: { otherParam: 1 }
        }),
        err => err.status === 400,
        err => err.message.includes('Missing data for placeholder')
      )
    }
  )
}

// =============================================================================
// User Service Integration Tests - Full Lifecycle
// =============================================================================

// testUserService_SelfSignupFlow.solo = true
export async function testUserService_SelfSignupFlow() {
  const username = testUsername('self_signup')
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      // Cleanup from previous runs
      await cleanupTestUsers(TEST_PREFIX)

      const password = 'testpassword123'
      
      // 1. Create user with password (self-signup)
      const createResult = await callService('user-service', {
        create: {
          username,
          password
        }
      })
      
      await assert(createResult,
        r => r.create !== undefined,
        r => r.create.username === username,
        r => r.create.isRegistered === true,
        r => r.create.isVerified === false,
        r => r.create.isActive === false,
        r => r.create.token === undefined
      )
      
      const userId = createResult.create.userId

      const tokenResult = await callService('user-service', {
        createToken: { userId, expiresIn: 3600000 }
      })

      const token = tokenResult.createToken.token
      
      // 2. Verify user
      const verifyResult = await callService('user-service', {
        verify: { userId, password, token }
      })
      
      await assert(verifyResult,
        r => r.verify.isVerified === true,
        r => r.verify.verifiedOn !== undefined
      )
      
      // 3. Activate user
      const updateResult = await callService('user-service', {
        update: { userId, isActive: true }
      })
      
      await assert(updateResult,
        r => r.update.isActive === true
      )
      
      // 4. Get final user state
      const getResult = await callService('user-service', {
        get: { userId }
      })
      
      await assert(getResult,
        r => r.get.isRegistered === true,
        r => r.get.isVerified === true,
        r => r.get.isActive === true
      )
      
      // Cleanup
      await callService('user-service', { remove: { userId } })
    }
  )
}

// testUserService_AdminInviteFlow.solo = true
// TODO test is flaky
export async function testUserService_AdminInviteFlow() {
  const username = testUsername('admin_invite')
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      // Cleanup
      await cleanupTestUsers(TEST_PREFIX)
      
      // 1. Admin creates user without password
      const createResult = await callService('user-service', {
        create: {
          username,
          isActive: true  // Pre-activate
        }
      })
      
      await assert(createResult,
        r => r.create.username === username,
        r => r.create.isRegistered === false,
        r => r.create.isVerified === false,
        r => r.create.isActive === true,
        r => r.create.token !== undefined,
        r => typeof r.create.token === 'string'
      )
      
      const token = createResult.create.token
      
      // 2. User registers with token
      const registerResult = await callService('user-service', {
        register: {
          token,
          password: 'userpassword123'
        }
      })
      
      await assert(registerResult,
        r => r.register.isRegistered === true,
        r => r.register.isVerified === true,  // Token registration verifies too
        r => r.register.registeredOn !== undefined,
        r => r.register.verifiedOn !== undefined
      )
      
      // 3. Get final state
      const getResult = await callService('user-service', {
        get: { username }
      })
      
      await assert(getResult,
        r => r.get.isRegistered === true,
        r => r.get.isVerified === true,
        r => r.get.isActive === true
      )
      
      // Cleanup
      await callService('user-service', { remove: { username } })
    }
  )
}

// testUserService_VerifyAndRegister.solo = true
export async function testUserService_VerifyAndRegister() {
  const username = testUsername('verify_register')
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      await cleanupTestUsers(TEST_PREFIX)
      
      // 1. Admin creates user without password (invite flow)
      const createResult = await callService('user-service', {
        create: { username, isActive: false }
      })
      
      await assert(createResult,
        r => r.create.username === username,
        r => r.create.isRegistered === false,
        r => r.create.token !== undefined
      )
      
      const token = createResult.create.token
      
      // 2. User redeems token with password via verify
      const verifyResult = await callService('user-service', {
        verify: { username, token, password: 'securepass123' }
      })
      
      await assert(verifyResult,
        r => r.verify.isRegistered === true,
        r => r.verify.isVerified === true,
        r => r.verify.registeredOn !== undefined,
        r => r.verify.verifiedOn !== undefined
      )
      
      // 3. User can now log in
      const checkResult = await callService('user-service', {
        checkPassword: { username, password: 'securepass123' }
      })
      await assert(checkResult, r => r.checkPassword === true)
      
      // Cleanup
      await callService('user-service', { remove: { username } })
    }
  )
}

export async function testUserService_InvalidToken() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      await assertErr(
        async () => callService('user-service', {
          register: {
            token: 'invalid-token-that-does-not-exist',
            password: 'password123'
          }
        }),
        err => err.status === 401,
        err => err.message.includes('Invalid or expired token')
      )
    }
  )
}

// testUserService_TokenRegeneration.solo = true
// TODO test is flaky
export async function testUserService_TokenRegeneration() {
  const username = testUsername('token_regen')
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      // Cleanup
      await cleanupTestUsers(TEST_PREFIX)
      
      // 1. Create user
      const createResult = await callService('user-service', {
        create: { username }
      })
      
      const userId = createResult.create.userId
      const firstToken = createResult.create.token
      
      // 2. Generate new token
      const regenResult = await callService('user-service', {
        createToken: {
          userId,
          expiresIn: 3600000  // 1 hour
        }
      })
      
      await assert(regenResult,
        r => r.createToken.userId === userId,
        r => r.createToken.token !== undefined,
        r => r.createToken.token !== firstToken,  // Different token
        r => r.createToken.expiresAt !== undefined
      )
      
      // 3. Old token should not work
      await assertErr(
        async () => callService('user-service', {
          register: {
            token: firstToken,
            password: 'password123'
          }
        }),
        err => err.status === 401
      )
      
      // 4. New token should work
      const newToken = regenResult.createToken.token
      const registerResult = await callService('user-service', {
        register: {
          token: newToken,
          password: 'password123'
        }
      })
      
      await assert(registerResult,
        r => r.register.isRegistered === true
      )
      
      // Cleanup
      await callService('user-service', { remove: { userId } })
    }
  )
}

export async function testUserService_DuplicateUsername() {
  const username = testUsername('duplicate')
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      // Cleanup
      await cleanupTestUsers(TEST_PREFIX)
      
      // Create first user
      await callService('user-service', {
        create: { username, password: 'password123' }
      })
      
      // Try to create duplicate
      await assertErr(
        async () => callService('user-service', {
          create: { username, password: 'password456' }
        }),
        err => err.status === 400 || err.message.includes('unique') || err.message.includes('duplicate')
      )
      
      // Cleanup
      await callService('user-service', { remove: { username } })
    }
  )
}

export async function testUserService_UsernameUpdate() {
  const oldUsername = testUsername('old_name')
  const newUsername = testUsername('new_name')
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      // Cleanup
      await cleanupTestUsers(TEST_PREFIX)
      
      // Create user
      const createResult = await callService('user-service', {
        create: { username: oldUsername, password: 'password123' }
      })
      const userId = createResult.create.userId
      
      // Update username
      const updateResult = await callService('user-service', {
        update: { userId, username: newUsername }
      })
      
      await assert(updateResult,
        r => r.update.username === newUsername,
        r => r.update.usernameUpdatedOn !== undefined  // Timestamp tracked
      )
      
      // Old username should not find user
      const oldGet = await callService('user-service', {
        get: { username: oldUsername }
      })
      await assert(oldGet, r => r.get === undefined)
      
      // New username should work
      const newGet = await callService('user-service', {
        get: { username: newUsername }
      })
      await assert(newGet, r => r.get.userId === userId)
      
      // Cleanup
      await callService('user-service', { remove: { userId } })
    }
  )
}

export async function testUserService_RemoveUser() {
  const username = testUsername('to_remove')
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      // Cleanup
      await cleanupTestUsers(TEST_PREFIX)
      
      // Create user
      const createResult = await callService('user-service', {
        create: { username, password: 'password123' }
      })
      const userId = createResult.create.userId
      
      // Verify exists
      const getResult = await callService('user-service', {
        get: { userId }
      })
      await assert(getResult, r => r.get !== undefined)
      
      // Remove
      const removeResult = await callService('user-service', {
        remove: { userId }
      })
      await assert(removeResult, r => r.remove !== undefined)
      
      // Verify gone
      const getAfter = await callService('user-service', {
        get: { userId }
      })
      await assert(getAfter, r => r.get === undefined)
    }
  )
}
