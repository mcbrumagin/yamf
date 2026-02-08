/**
 * User Service Validators
 * 
 * Action-specific validators composed from the base schema.
 * Supports configurable username validation (email, pattern, or custom).
 */

import {
  is,
  createValidator,
  ValidationError
} from '@yamf/shared/validator'

import { HttpError } from '@yamf/core'

// =============================================================================
// Username Validator Factory
// =============================================================================

/**
 * Create a username validator based on configuration
 * 
 * @param {Object} config - Username validation configuration
 * @param {string} config.type - 'email' | 'pattern' | 'custom' | 'any'
 * @param {RegExp} config.pattern - Regex pattern (used if type: 'pattern')
 * @param {Function} config.validate - Custom validator function (used if type: 'custom')
 * @param {string} config.message - Custom error message
 * @returns {Object} Schema validator for username
 */
export function createUsernameValidator(config = {}) {
  const { type = 'email', pattern, validate, message } = config

  if (type === 'email') {
    return is.email
  }

  if (type === 'pattern') {
    if (!pattern) {
      throw new Error('usernameValidation.pattern is required when type is "pattern"')
    }
    return is.string({ pattern, minLength: 1 })
  }

  if (type === 'custom') {
    if (typeof validate !== 'function') {
      throw new Error('usernameValidation.validate must be a function when type is "custom"')
    }
    return is.refine(
      is.string({ minLength: 1 }),
      validate,
      message || 'Invalid username'
    )
  }

  // 'any' or fallback: any non-empty string
  return is.string({ minLength: 1 })
}

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Create the full user schema based on configuration
 * 
 * @param {Object} usernameValidator - The username validator to use
 * @returns {Object} Full user schema
 */
export function createUserSchema(usernameValidator) {
  return {
    // Core identity
    userId: is.int({ positive: true }),       // SERIAL PRIMARY KEY
    username: usernameValidator,              // validated based on config
    
    // Authentication (internal, never exposed in responses)
    hash: is(is.nullable, is.base64()),
    salt: is(is.nullable, is.base64()),
    
    // Status flags
    isRegistered: is.bool,                    // user has set their password
    isActive: is.bool,                        // account is active/enabled
    isVerified: is.bool,                      // user has verified their identity
    
    // Lifecycle dates
    createdOn: is.datetime(),
    registeredOn: is(is.nullable, is.datetime()),
    verifiedOn: is(is.nullable, is.datetime()),
    usernameUpdatedOn: is(is.nullable, is.datetime()),
    
    // Registration token (internal, never exposed)
    registrationTokenHash: is(is.nullable, is.base64()),
    registrationTokenSalt: is(is.nullable, is.base64()),
    registrationTokenExpires: is(is.nullable, is.datetime()),
    
    // Future: Social login
    authProvider: is(is.nullable, is.oneOf('local', 'google', 'github', 'microsoft', 'apple')),
    externalId: is(is.nullable, is.string()),
    
    // Future: MFA
    mfaEnabled: is.bool,
    mfaType: is(is.nullable, is.oneOf('totp', 'sms', 'email')),
    mfaSecret: is(is.nullable, is.string()),  // encrypted
  }
}

// =============================================================================
// Action Validators Factory
// =============================================================================

/**
 * Create all action validators based on configuration
 * 
 * @param {Object} usernameValidator - The username validator to use
 * @returns {Object} Object containing all action validators
 */
export function createActionValidators(usernameValidator) {
  const baseSchema = createUserSchema(usernameValidator)

  // Create (admin without password OR self-signup with password)
  const validateCreate = createValidator({
    username: baseSchema.username,
    password: is(is.optional, is.password({ 
      minLength: 8, 
      requireUppercase: false, 
      requireLowercase: false, 
      requireNumber: false 
    })),
    isActive: is(is.optional, baseSchema.isActive),
  }, { name: 'CreateUser' })

  // Register with token (complete registration)
  const validateRegisterWithToken = createValidator({
    token: is.string({ minLength: 1 }),
    password: is.password({ 
      minLength: 8, 
      requireUppercase: false, 
      requireLowercase: false, 
      requireNumber: false 
    }),
  }, { name: 'RegisterWithToken' })

  // Get: requires at least one identifier
  const validateGet = createValidator(
    is.refine(
      is.object({
        userId: is(is.optional, baseSchema.userId),
        username: is(is.optional, baseSchema.username),
      }),
      (data) => data.userId !== undefined || data.username !== undefined,
      'At least one of userId or username is required'
    ),
    { name: 'GetUser' }
  )

  // Update: requires userId, optional other fields
  const validateUpdate = createValidator({
    userId: baseSchema.userId,
    username: is(is.optional, baseSchema.username),
    isActive: is(is.optional, baseSchema.isActive),
    // Note: isRegistered and isVerified are managed by specific actions, not general update
  }, { name: 'UpdateUser' })

  // Remove: requires at least one identifier
  const validateRemove = createValidator(
    is.refine(
      is.object({
        userId: is(is.optional, baseSchema.userId),
        username: is(is.optional, baseSchema.username),
      }),
      (data) => data.userId !== undefined || data.username !== undefined,
      'At least one of userId or username is required'
    ),
    { name: 'RemoveUser' }
  )

  // Verify: userId or token
  const validateVerify = createValidator(
    is.refine(
      is.object({
        userId: is(is.optional, baseSchema.userId),
        token: is(is.optional, is.string({ minLength: 1 })),
      }),
      (data) => data.userId !== undefined || data.token !== undefined,
      'Either userId or token is required'
    ),
    { name: 'VerifyUser' }
  )

  // Generate token: requires userId
  const validateGenerateToken = createValidator({
    userId: baseSchema.userId,
    expiresIn: is(is.optional, is.int({ positive: true })),  // ms
  }, { name: 'GenerateToken' })

  return {
    validateCreate,
    validateRegisterWithToken,
    validateGet,
    validateUpdate,
    validateRemove,
    validateVerify,
    validateGenerateToken,
    baseSchema,
  }
}

// =============================================================================
// Validation Error Helper
// =============================================================================

/**
 * Creates an HttpError with validation failures attached.
 * 
 * @param {string} action - The action name (e.g., 'create', 'update')
 * @param {ValidationError} validationError - The validation error with failures
 * @returns {HttpError} HttpError with failures attached
 */
export function createValidationError(action, validationError) {
  // TODO: Consider adding a helper like this to the validator library
  const error = new HttpError(400, `Invalid ${action} user data: ${validationError.message}`)
  error.failures = validationError.failures.map(f => ({
    path: f.path,
    constraint: f.constraint,
    message: f.message,
    // Don't include the actual value for security
  }))
  error.stack = error.message + '\n' + 
    error.failures.map(f => `  - ${f.path}: ${f.message}`).join('\n') + '\n' + 
    error.stack.split('\n').slice(1).join('\n')
  return error
}

export { ValidationError }
