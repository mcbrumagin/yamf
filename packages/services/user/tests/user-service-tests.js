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

export function testIsTokenExpiredHandlesVariedShapes() {
  return assert(
    isTokenExpired(null),
    (r) => r === false
  ) && assert(
    isTokenExpired(''),
    (r) => r === false
  ) && assert(
    isTokenExpired(1_600_000_000),
    (r) => r === true
  ) && assert(
    isTokenExpired(String(Date.now() + 60_000)),
    (r) => r === false
  ) && assert(
    isTokenExpired(170n),
    (r) => r === true
  ) && assert(
    isTokenExpired({}),
    (r) => r === false
  )
}

// =============================================================================
// Action Validators Tests
// =============================================================================

export function testActionValidators_Create() {
  const validators = createActionValidators()
  
  const result = validators.validateCreate({
    username: 'test@example.com',
    password: 'password123',
    isActive: true
  })
  assert(result,
    r => r.username === 'test@example.com',
    r => r.password === 'password123',
    r => r.isActive === true
  )
}

export function testActionValidators_Create_RequiresUsernameAndPassword() {
  const validators = createActionValidators()
  assertErr(
    () => validators.validateCreate({ password: 'password123' }),
    err => err instanceof ValidationError
  )
  assertErr(
    () => validators.validateCreate({ username: 'a@b.com' }),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_Invite() {
  const validators = createActionValidators()
  const ok = validators.validateInvite({ displayName: 'Guest', isActive: true })
  assert(ok, r => r.displayName === 'Guest')

  assertErr(
    () => validators.validateInvite({ username: 'a@b.com', password: 'x' }),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_RegisterWithToken() {
  const validators = createActionValidators()
  
  const result = validators.validateRegister({
    token: 'abc123token',
    password: 'mypassword123'
  })
  
  assert(result,
    r => r.token === 'abc123token',
    r => r.password === 'mypassword123'
  )
}

export function testActionValidators_RegisterWithToken_MissingToken() {
  const validators = createActionValidators()
  
  assertErr(
    () => validators.validateRegister({ password: 'mypassword123' }),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_Verify() {
  const validators = createActionValidators()
  
  const result = validators.validateVerify({
    username: 'test@example.com',
    token: 'abc123token',
    password: 'mypassword123'
  })
  
  assert(result,
    r => r.token === 'abc123token',
    r => r.password === 'mypassword123'
  )
}

export function testActionValidators_Verify_MissingToken() {
  const validators = createActionValidators()
  
  assertErr(
    () => validators.validateVerify({ password: 'mypassword123' }),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_Get_ByUserId() {
  const validators = createActionValidators()
  
  const result = validators.validateGet({ userId: 123 })
  assert(result, r => r.userId === 123)
}

export function testActionValidators_Get_ByUsername() {
  const validators = createActionValidators()
  
  const result = validators.validateGet({ username: 'test@example.com' })
  assert(result, r => r.username === 'test@example.com')
}

export function testActionValidators_Get_RequiresIdentifier() {
  const validators = createActionValidators()
  
  assertErr(
    () => validators.validateGet({}),
    err => err instanceof ValidationError
  )
}

export function testActionValidators_Update() {
  const validators = createActionValidators()
  
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

export function testActionValidators_Verify_ByUserId() {
  const validators = createActionValidators()
  
  const result = validators.validateVerify({ userId: 123 })
  assert(result, r => r.userId === 123)
}

export function testActionValidators_Verify_ByToken() {
  const validators = createActionValidators()
  
  const result = validators.validateVerify({ userId: 123, token: 'verification-token' })
  assert(result, r => r.token === 'verification-token')
}

export function testActionValidators_GenerateToken() {
  const validators = createActionValidators()
  
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
    () => registryServer(),
    () => createMockPostgresService({
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
        () => createUserService(),
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

export async function testUserService_InvitePendingUser() {
  await terminateAfter(
    () => registryServer(),
    () => createMockPostgresService({
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
        () => createUserService(),
        async () => {
          const result = await callService('user-service', {
            invite: {
              username: 'invited@example.com',
              isActive: true
            }
          })
          
          await assert(result,
            r => r.invite !== undefined,
            r => r.invite.username === 'invited@example.com',
            r => r.invite.isRegistered === false,
            r => r.invite.isActive === true,
            r => r.invite.token !== undefined,
            r => typeof r.invite.token === 'string',
            r => r.invite.token.length > 0
          )
        }
      )
    }
  )
}

export async function testUserService_GetUser() {
  await terminateAfter(
    () => registryServer(),
    () => createMockPostgresService({
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
        () => createUserService(),
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
    () => registryServer(),
    () => createMockPostgresService({
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
        () => createUserService(),
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
    () => registryServer(),
    () => createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': [],
      'UPDATE yamf.user': (data) => [{
        userId: data.userId,
        username: 'test@example.com',
        isRegistered: true,
        isActive: true,
        isVerified: true,
        verifiedOn: new Date().toISOString()
      }],
      'SELECT': () => [{
        userId: 1,
        username: 'test@example.com',
        hash: 'hash',
        salt: 'salt'
      }]
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        () => createUserService(),
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
    () => registryServer(),
    () => createMockPostgresService({
      'CREATE TABLE': [],
      'ALTER TABLE': []
    }),
    async () => {
      const { default: createUserService } = await import('../service.js')
      
      await terminateAfter(
        () => createUserService(),
        async () => {
          await assertErr(
            async () => callService('user-service', {
              create: { username: '!@#$%^&*()-=~`[]{}|;:' }
            }),
            err => err.status === 400,
            err => err.message.includes('Invalid')
          )
        }
      )
    }
  )
}
