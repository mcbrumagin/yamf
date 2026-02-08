/**
 * User Service Unit Tests
 * 
 * Tests user service functionality with mocked SQL function.
 * These tests do not require a running PostgreSQL database.
 */

import {
  assert,
  assertErr,
  terminateAfter
} from '@yamf/test'

import {
  registryServer,
  createService,
  callService,
  HttpError
} from '@yamf/core'

import {
  createUsernameValidator,
  createActionValidators,
  createValidationError,
  ValidationError
} from '../validators.js'

import {
  generateRegistrationToken,
  verifyRegistrationToken,
  calculateTokenExpiry,
  isTokenExpired
} from '../token.js'

import { is } from '@yamf/shared/validator'

// =============================================================================
// Token Utility Tests
// =============================================================================

export async function testGenerateRegistrationToken() {
  const { token, hash, salt } = await generateRegistrationToken(32)
  
  await assert({ token, hash, salt },
    r => typeof r.token === 'string',
    r => r.token.length > 0,
    r => typeof r.hash === 'string',
    r => r.hash.length > 0,
    r => typeof r.salt === 'string',
    r => r.salt.length > 0,
    // Token should be URL-safe base64
    r => !r.token.includes('+'),
    r => !r.token.includes('/'),
    r => !r.token.includes('=')
  )
}

export async function testVerifyRegistrationToken_Valid() {
  const { token, hash, salt } = await generateRegistrationToken(32)
  const isValid = await verifyRegistrationToken(token, hash, salt)
  
  await assert(isValid, v => v === true)
}

export async function testVerifyRegistrationToken_Invalid() {
  const { hash, salt } = await generateRegistrationToken(32)
  const isValid = await verifyRegistrationToken('wrong-token', hash, salt)
  
  await assert(isValid, v => v === false)
}

export async function testVerifyRegistrationToken_NullInputs() {
  const isValid1 = await verifyRegistrationToken(null, 'hash', 'salt')
  const isValid2 = await verifyRegistrationToken('token', null, 'salt')
  const isValid3 = await verifyRegistrationToken('token', 'hash', null)
  
  await assert([isValid1, isValid2, isValid3],
    r => r[0] === false,
    r => r[1] === false,
    r => r[2] === false
  )
}

export function testCalculateTokenExpiry() {
  const expiry = calculateTokenExpiry(60000) // 1 minute
  
  assert(expiry,
    e => e instanceof Date,
    e => e.getTime() > Date.now(),
    e => e.getTime() <= Date.now() + 61000
  )
}

export function testCalculateTokenExpiry_Null() {
  const expiry = calculateTokenExpiry(null)
  assert(expiry, e => e === null)
}

export function testIsTokenExpired_NotExpired() {
  const futureDate = new Date(Date.now() + 60000)
  assert(isTokenExpired(futureDate), r => r === false)
}

export function testIsTokenExpired_Expired() {
  const pastDate = new Date(Date.now() - 60000)
  assert(isTokenExpired(pastDate), r => r === true)
}

export function testIsTokenExpired_NullMeansNoExpiry() {
  assert(isTokenExpired(null), r => r === false)
}

export function testIsTokenExpired_StringDate() {
  const futureString = new Date(Date.now() + 60000).toISOString()
  const pastString = new Date(Date.now() - 60000).toISOString()
  
  assert(isTokenExpired(futureString), r => r === false)
  assert(isTokenExpired(pastString), r => r === true)
}

// =============================================================================
// Username Validator Tests
// =============================================================================

export function testUsernameValidator_Email() {
  const validator = createUsernameValidator({ type: 'email' })
  
  assert(validator,
    v => v.type === 'email',
    v => v.xss === 'check'
  )
}

export function testUsernameValidator_Pattern() {
  const validator = createUsernameValidator({
    type: 'pattern',
    pattern: /^[a-z0-9_]{3,20}$/
  })
  
  assert(validator,
    v => v.type === 'string',
    v => v.pattern instanceof RegExp
  )
}

export function testUsernameValidator_Custom() {
  const validator = createUsernameValidator({
    type: 'custom',
    validate: (username) => username.length >= 3,
    message: 'Username too short'
  })
  
  assert(validator,
    v => v.type === 'custom' || v.refine !== undefined
  )
}

export function testUsernameValidator_Any() {
  const validator = createUsernameValidator({ type: 'any' })
  
  assert(validator,
    v => v.type === 'string',
    v => v.minLength === 1
  )
}

export function testUsernameValidator_PatternRequiresPattern() {
  assertErr(
    () => createUsernameValidator({ type: 'pattern' }),
    err => err.message.includes('pattern is required')
  )
}

export function testUsernameValidator_CustomRequiresFunction() {
  assertErr(
    () => createUsernameValidator({ type: 'custom', validate: 'not a function' }),
    err => err.message.includes('must be a function')
  )
}

// =============================================================================
// Action Validators Tests
// =============================================================================

export function testActionValidators_Create() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  // Valid: with password
  const result1 = validators.validateCreate({
    username: 'test@example.com',
    password: 'password123'
  })
  assert(result1,
    r => r.username === 'test@example.com',
    r => r.password === 'password123'
  )
  
  // Valid: without password (admin create)
  const result2 = validators.validateCreate({
    username: 'admin@example.com',
    isActive: true
  })
  assert(result2,
    r => r.username === 'admin@example.com',
    r => r.isActive === true
  )
}

export function testActionValidators_Create_InvalidEmail() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  assertErr(
    () => validators.validateCreate({ username: 'not-an-email', password: 'password123' }),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_RegisterWithToken() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  const result = validators.validateRegisterWithToken({
    token: 'abc123token',
    password: 'mypassword123'
  })
  
  assert(result,
    r => r.token === 'abc123token',
    r => r.password === 'mypassword123'
  )
}

export function testActionValidators_RegisterWithToken_MissingToken() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  assertErr(
    () => validators.validateRegisterWithToken({ password: 'mypassword123' }),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_Get_ByUserId() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  const result = validators.validateGet({ userId: 123 })
  assert(result, r => r.userId === 123)
}

export function testActionValidators_Get_ByUsername() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  const result = validators.validateGet({ username: 'test@example.com' })
  assert(result, r => r.username === 'test@example.com')
}

export function testActionValidators_Get_RequiresIdentifier() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  assertErr(
    () => validators.validateGet({}),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_Update() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  const result = validators.validateUpdate({
    userId: 123,
    username: 'new@example.com',
    isActive: false
  })
  
  assert(result,
    r => r.userId === 123,
    r => r.username === 'new@example.com',
    r => r.isActive === false
  )
}

export function testActionValidators_Update_RequiresUserId() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  assertErr(
    () => validators.validateUpdate({ username: 'new@example.com' }),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_Verify_ByUserId() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  const result = validators.validateVerify({ userId: 123 })
  assert(result, r => r.userId === 123)
}

export function testActionValidators_Verify_ByToken() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  const result = validators.validateVerify({ token: 'verification-token' })
  assert(result, r => r.token === 'verification-token')
}

export function testActionValidators_GenerateToken() {
  const usernameValidator = createUsernameValidator({ type: 'email' })
  const validators = createActionValidators(usernameValidator)
  
  const result = validators.validateGenerateToken({
    userId: 123,
    expiresIn: 86400000
  })
  
  assert(result,
    r => r.userId === 123,
    r => r.expiresIn === 86400000
  )
}

// =============================================================================
// Validation Error Helper Tests
// =============================================================================

export function testCreateValidationError() {
  const validationError = new ValidationError([
    { path: 'username', constraint: 'email', message: 'Invalid email' },
    { path: 'password', constraint: 'minLength', message: 'Too short' }
  ], 'TestSchema')
  
  const httpError = createValidationError('create', validationError)
  
  assertErr(httpError,
    e => e instanceof HttpError,
    e => e.status === 400,
    e => e.message.includes('Invalid create user data'),
    e => Array.isArray(e.failures),
    e => e.failures.length === 2
  )
}

// =============================================================================
// Mocked User Service Tests
// =============================================================================

/**
 * Create a mock SQL function for testing
 */
function createMockSql(mockResponses = {}) {
  const calls = []
  
  return async function mockSql(template, data = {}) {
    calls.push({ template, data })
    
    // Find matching response based on template content
    for (const [pattern, response] of Object.entries(mockResponses)) {
      if (template.includes(pattern)) {
        if (typeof response === 'function') {
          return response(data)
        }
        return response
      }
    }
    
    // Default: return empty array
    return []
  }
}

/**
 * Create a mock PostgreSQL service for testing
 */
async function createMockPostgresService(mockResponses = {}) {
  const mockSql = createMockSql(mockResponses)
  
  return await createService('postgres-service', async ({ template, data }) => {
    return await mockSql(template, data)
  })
}

export async function testUserService_CreateWithPassword() {
  await terminateAfter(
    await registryServer(),
    await createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': [],
      'INSERT INTO yamf.user': (data) => [{
        userId: 1,
        username: data.username,
        isRegistered: true,
        isActive: false,
        isVerified: false,
        createdOn: new Date().toISOString()
      }]
    }),
    async () => {
      // Dynamic import to avoid initialization before mock is ready
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        await createUserService(),
        async () => {
          const result = await callService('user-service', {
            create: {
              username: 'test@example.com',
              password: 'password123'
            }
          })
          
          await assert(result,
            r => r.create !== undefined,
            r => r.create.username === 'test@example.com',
            r => r.create.isRegistered === true,
            r => r.create.isVerified === false,
            r => r.create.registrationToken === undefined  // No token for password signup
          )
        }
      )
    }
  )
}

export async function testUserService_CreateWithoutPassword() {
  await terminateAfter(
    await registryServer(),
    await createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': [],
      'INSERT INTO yamf.user': (data) => [{
        userId: 2,
        username: data.username,
        isRegistered: false,
        isActive: data.isActive || false,
        isVerified: false,
        createdOn: new Date().toISOString()
      }]
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        await createUserService(),
        async () => {
          const result = await callService('user-service', {
            create: {
              username: 'invited@example.com',
              isActive: true
            }
          })
          
          await assert(result,
            r => r.create !== undefined,
            r => r.create.username === 'invited@example.com',
            r => r.create.isRegistered === false,
            r => r.create.isActive === true,
            r => r.create.registrationToken !== undefined,  // Token returned
            r => typeof r.create.registrationToken === 'string',
            r => r.create.registrationToken.length > 0
          )
        }
      )
    }
  )
}

export async function testUserService_GetUser() {
  await terminateAfter(
    await registryServer(),
    await createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': [],
      'SELECT': () => [{
        userId: 1,
        username: 'test@example.com',
        isRegistered: true,
        isActive: true,
        isVerified: true,
        createdOn: '2024-01-01T00:00:00Z'
      }]
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        await createUserService(),
        async () => {
          const result = await callService('user-service', {
            get: { userId: 1 }
          })
          
          await assert(result,
            r => r.get !== undefined,
            r => r.get.userId === 1,
            r => r.get.username === 'test@example.com'
          )
        }
      )
    }
  )
}

export async function testUserService_UpdateUser() {
  await terminateAfter(
    await registryServer(),
    await createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': [],
      'UPDATE yamf.user': (data) => [{
        userId: data.userId,
        username: data.username || 'test@example.com',
        isRegistered: true,
        isActive: data.isActive !== null ? data.isActive : true,
        isVerified: true,
        usernameUpdatedOn: data.username ? new Date().toISOString() : null
      }]
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        await createUserService(),
        async () => {
          const result = await callService('user-service', {
            update: { userId: 1, isActive: false }
          })
          
          await assert(result,
            r => r.update !== undefined,
            r => r.update.userId === 1,
            r => r.update.isActive === false
          )
        }
      )
    }
  )
}

export async function testUserService_VerifyUser() {
  await terminateAfter(
    await registryServer(),
    await createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': [],
      'UPDATE yamf.user': (data) => [{
        userId: data.userId,
        username: 'test@example.com',
        isRegistered: true,
        isActive: true,
        isVerified: true,
        verifiedOn: new Date().toISOString()
      }]
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        await createUserService(),
        async () => {
          const result = await callService('user-service', {
            verify: { userId: 1 }
          })
          
          await assert(result,
            r => r.verify !== undefined,
            r => r.verify.isVerified === true,
            r => r.verify.verifiedOn !== undefined
          )
        }
      )
    }
  )
}

export async function testUserService_ValidationError() {
  await terminateAfter(
    await registryServer(),
    await createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': []
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        await createUserService(),
        async () => {
          await assertErr(
            async () => callService('user-service', {
              create: { username: 'not-an-email' }
            }),
            err => err.status === 400,
            err => err.message.includes('Invalid')
          )
        }
      )
    }
  )
}

export async function testUserService_CustomUsernameValidation() {
  await terminateAfter(
    await registryServer(),
    await createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': [],
      'INSERT INTO yamf.user': (data) => [{
        userId: 1,
        username: data.username,
        isRegistered: true,
        isActive: false,
        isVerified: false,
        createdOn: new Date().toISOString()
      }]
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      // Create with pattern-based username validation
      await terminateAfter(
        await createUserService({
          serviceName: 'custom-user-service',
          usernameValidation: {
            type: 'pattern',
            pattern: /^[a-z0-9_]{3,20}$/
          }
        }),
        async () => {
          // Valid username
          const result = await callService('custom-user-service', {
            create: {
              username: 'john_doe',
              password: 'password123'
            }
          })
          
          await assert(result,
            r => r.create.username === 'john_doe'
          )
        }
      )
    }
  )
}

export async function testUserService_Hooks() {
  let hooksCalled = {
    onTokenGenerated: false,
    onRegistered: false,
    onVerified: false
  }
  
  await terminateAfter(
    await registryServer(),
    await createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': [],
      'INSERT INTO yamf.user': (data) => [{
        userId: 1,
        username: data.username,
        isRegistered: false,
        isActive: true,
        isVerified: false,
        createdOn: new Date().toISOString()
      }],
      'UPDATE yamf.user': (data) => [{
        userId: 1,
        username: 'test@example.com',
        isRegistered: true,
        isActive: true,
        isVerified: true,
        verifiedOn: new Date().toISOString()
      }]
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        await createUserService({
          serviceName: 'hooks-test-service',
          hooks: {
            onTokenGenerated: async (userId, token) => {
              hooksCalled.onTokenGenerated = true
              assert(userId, u => u === 1)
              assert(token, t => typeof t === 'string')
            },
            onVerified: async (user) => {
              hooksCalled.onVerified = true
              assert(user, u => u.isVerified === true)
            }
          }
        }),
        async () => {
          // Create without password (triggers onTokenGenerated)
          await callService('hooks-test-service', {
            create: { username: 'test@example.com' }
          })
          
          // Verify user (triggers onVerified)
          await callService('hooks-test-service', {
            verify: { userId: 1 }
          })
          
          await assert(hooksCalled,
            h => h.onTokenGenerated === true,
            h => h.onVerified === true
          )
        }
      )
    }
  )
}
