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
  HttpError
} from '@yamf/core'

import createPostgreSqlService from '@yamf/services-postgres'
import createUserService from '../service.js'

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_PSQL_CONFIG = process.env.TEST_PSQL_URL || 
  `postgres://${process.env.PGUSER || 'yamf'}:${process.env.PGPASSWORD || 'changeme'}@localhost/${process.env.PGDATABASE || 'yamf_test'}`

// Unique test user prefix to avoid conflicts
const TEST_PREFIX = `test_${Date.now()}_`

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

export async function testUserService_SelfSignupFlow() {
  const username = testUsername('self_signup')
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService(),
    async () => {
      // Cleanup from previous runs
      await cleanupTestUsers(TEST_PREFIX)
      
      // 1. Create user with password (self-signup)
      const createResult = await callService('user-service', {
        create: {
          username,
          password: 'testpassword123'
        }
      })
      
      await assert(createResult,
        r => r.create !== undefined,
        r => r.create.username === username,
        r => r.create.isRegistered === true,
        r => r.create.isVerified === false,
        r => r.create.isActive === false,
        r => r.create.registrationToken === undefined
      )
      
      const userId = createResult.create.userId
      
      // 2. Verify user
      const verifyResult = await callService('user-service', {
        verify: { userId }
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
        r => r.create.registrationToken !== undefined,
        r => typeof r.create.registrationToken === 'string'
      )
      
      const token = createResult.create.registrationToken
      console.warn('TOKEN', token)
      
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
        err => err.message.includes('Invalid or expired')
      )
    }
  )
}

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
      const firstToken = createResult.create.registrationToken
      
      // 2. Generate new token
      const regenResult = await callService('user-service', {
        generateToken: {
          userId,
          expiresIn: 3600000  // 1 hour
        }
      })
      
      await assert(regenResult,
        r => r.generateToken.userId === userId,
        r => r.generateToken.registrationToken !== undefined,
        r => r.generateToken.registrationToken !== firstToken,  // Different token
        r => r.generateToken.expiresAt !== undefined
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
      const newToken = regenResult.generateToken.registrationToken
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

// =============================================================================
// Custom Username Validation Tests
// =============================================================================

export async function testUserService_PatternUsernameValidation() {
  const username = 'john_doe_123'
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService({
      serviceName: 'pattern-user-service',
      usernameValidation: {
        type: 'pattern',
        pattern: /^[a-z0-9_]{3,20}$/
      }
    }),
    async () => {
      // Cleanup
      await callService('postgres-service', {
        template: `DELETE FROM yamf.user WHERE username = :username`,
        data: { username }
      })
      
      // Valid pattern username
      const createResult = await callService('pattern-user-service', {
        create: { username, password: 'password123' }
      })
      
      await assert(createResult, r => r.create.username === username)
      
      // Invalid pattern username
      await assertErr(
        async () => callService('pattern-user-service', {
          create: { username: 'Invalid Username!', password: 'password123' }
        }),
        err => err.status === 400
      )
      
      // Cleanup
      await callService('pattern-user-service', { remove: { username } })
    }
  )
}

// =============================================================================
// Hooks Integration Tests
// =============================================================================

export async function testUserService_HooksIntegration() {
  const username = testUsername('hooks_test')
  const hookEvents = []
  
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    await createUserService({
      serviceName: 'hooks-user-service',
      hooks: {
        onTokenGenerated: async (userId, token) => {
          hookEvents.push({ type: 'tokenGenerated', userId, hasToken: !!token })
        },
        onRegistered: async (user) => {
          hookEvents.push({ type: 'registered', userId: user.userId })
        },
        onVerified: async (user) => {
          hookEvents.push({ type: 'verified', userId: user.userId })
        }
      }
    }),
    async () => {
      // Cleanup
      await cleanupTestUsers(TEST_PREFIX)
      
      // Create without password (triggers onTokenGenerated)
      const createResult = await callService('hooks-user-service', {
        create: { username }
      })
      const userId = createResult.create.userId
      const token = createResult.create.registrationToken
      
      // Register with token (triggers onRegistered)
      await callService('hooks-user-service', {
        register: { token, password: 'password123' }
      })
      
      // Verify hooks were called
      await assert(hookEvents,
        h => h.length >= 2,
        h => h.some(e => e.type === 'tokenGenerated' && e.userId === userId),
        h => h.some(e => e.type === 'registered' && e.userId === userId)
      )
      
      // Cleanup
      await callService('hooks-user-service', { remove: { userId } })
    }
  )
}
