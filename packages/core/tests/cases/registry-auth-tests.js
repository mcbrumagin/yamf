import {
  assert,
  assertErr,
  assertErrEach,
  withEnv
} from '@yamf/test'

import { validateRegistryToken, validateRegistryEnvironment } from '../../src/registry/registry-auth.js'

/**
 * Gateway Authentication Tests
 * Tests for gateway/gateway-auth.js functions
 */

// Test validateRegistryToken with no token configured
export async function testValidateRegistryToken_NoTokenConfigured() {
  await withEnv({
    YAMF_REGISTRY_TOKEN: undefined
  }, async () => {
    const mockRequest = {
      headers: {}
    }
    
    const result = validateRegistryToken(mockRequest)
    
    await assert(result, r => r === true)
  })
}

// Test validateRegistryToken with valid token
export async function testValidateRegistryToken_ValidToken() {
  await withEnv({
    YAMF_REGISTRY_TOKEN: 'test-token-123'
  }, async () => {
    const mockRequest = {
      headers: {
        'yamf-registry-token': 'test-token-123'
      }
    }
    
    const result = validateRegistryToken(mockRequest)
    
    await assert(result, r => r === true)
  })
}

// Test validateRegistryToken with missing token
export async function testValidateRegistryToken_MissingToken() {
  await withEnv({
    YAMF_REGISTRY_TOKEN: 'required-token'
  }, async () => {
    const mockRequest = {
      headers: {}
    }
    
    await assertErr(
      () => validateRegistryToken(mockRequest),
      err => err.status === 403,
      err => err.message.includes('Registry token required')
    )
  })
}

// Test validateRegistryToken with invalid token
export async function testValidateRegistryToken_InvalidToken() {
  await withEnv({
    YAMF_REGISTRY_TOKEN: 'correct-token'
  }, async () => {
    const mockRequest = {
      headers: {
        'yamf-registry-token': 'wrong-token'
      }
    }
    
    await assertErr(
      () => validateRegistryToken(mockRequest),
      err => err.status === 403,
      err => err.message.includes('Invalid registry token')
    )
  })
}

// Test validateRegistryEnvironment in production without token
export async function testValidateRegistryEnvironment_ProductionWithoutToken() {
  await withEnv({
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: undefined
  }, async () => {
    await assertErr(
      () => validateRegistryEnvironment(),
      err => err.message.includes('FATAL'),
      err => err.message.includes('YAMF_REGISTRY_TOKEN'),
      err => err.message.toUpperCase().includes('PRODUCTION')
    )
  })
}

// Test validateRegistryEnvironment in staging without token
export async function testValidateRegistryEnvironment_StagingWithoutToken() {
  await withEnv({
    ENVIRONMENT: 'staging',
    YAMF_REGISTRY_TOKEN: undefined
  }, async () => {
    await assertErr(
      () => validateRegistryEnvironment(),
      err => err.message.includes('FATAL'),
      err => err.message.includes('YAMF_REGISTRY_TOKEN'),
      err => err.message.toLowerCase().includes('stag')
    )
  })
}

// Test validateRegistryEnvironment in production with token (should pass)
export async function testValidateRegistryEnvironment_ProductionWithToken() {
  await withEnv({
    ENVIRONMENT: 'production',
    YAMF_REGISTRY_TOKEN: 'secure-token-xyz'
  }, async () => {
    // Should not throw
    validateRegistryEnvironment()
  })
}

// Test validateRegistryEnvironment in staging with token (should pass)
export async function testValidateRegistryEnvironment_StagingWithToken() {
  await withEnv({
    ENVIRONMENT: 'staging',
    YAMF_REGISTRY_TOKEN: 'secure-token-xyz'
  }, async () => {
    // Should not throw
    validateRegistryEnvironment()
  })
}

// Test validateRegistryEnvironment in dev without token (should pass)
export async function testValidateRegistryEnvironment_DevWithoutToken() {
  await withEnv({
    ENVIRONMENT: 'development',
    YAMF_REGISTRY_TOKEN: undefined
  }, async () => {
    // Should not throw
    validateRegistryEnvironment()
  })
}

// Test validateRegistryEnvironment with case variations
export async function testValidateRegistryEnvironment_CaseInsensitive() {
  await assertErrEach([
    async () => withEnv({
      ENVIRONMENT: 'PRODUCTION',
      YAMF_REGISTRY_TOKEN: undefined
    }, async () => validateRegistryEnvironment()),
    async () => withEnv({
      ENVIRONMENT: 'PRODUCTION',
      YAMF_REGISTRY_TOKEN: undefined
    }, async () => validateRegistryEnvironment())
  ], err => err.message.includes('FATAL'))
}

// Test with partial environment name matches
export async function testValidateRegistryEnvironment_PartialMatch() {
  await withEnv({
    ENVIRONMENT: 'pre-production',
    YAMF_REGISTRY_TOKEN: undefined
  }, async () => {
    await assertErr(
      () => validateRegistryEnvironment(),
      err => err.message.includes('FATAL')
    )
  })
  
  await withEnv({
    ENVIRONMENT: 'staging-test',
    YAMF_REGISTRY_TOKEN: undefined
  }, async () => {
    await assertErr(
      () => validateRegistryEnvironment(),
      err => err.message.includes('FATAL')
    )
  })
}

// Test validateRegistryToken with request that has socket info
export async function testValidateRegistryToken_WithSocketInfo() {
  await withEnv({
    YAMF_REGISTRY_TOKEN: 'test-token'
  }, async () => {
    const mockRequest = {
      headers: {},
      socket: {
        remoteAddress: '127.0.0.1'
      }
    }
    
    await assertErr(
      () => validateRegistryToken(mockRequest),
      err => err.status === 403,
      err => err.message.includes('Registry token required')
    )
  })
}

