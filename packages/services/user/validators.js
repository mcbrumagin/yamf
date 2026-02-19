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
// Schema Definitions
// =============================================================================


const baseSchema = {
  // Core identity
  userId: is.int({ positive: true }),       // SERIAL PRIMARY KEY
  username: is.anyOf(is.email, is.regex(/^[a-zA-Z0-9_-]+$/, { minLength: 3 })),
  email: is(is.optional, is.email),
  phone: is(is.optional, is.phone),
  
  // Role & Permissions
  role: is(is.optional, is.string),
  permissions: is(is.optional, is.array(is.string())),
  
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
  
  // Token (internal, never exposed - used for registration or verification)
  tokenHash: is(is.nullable, is.base64()),
  tokenSalt: is(is.nullable, is.base64()),
  tokenExpires: is(is.nullable, is.datetime()),
  
  // Future: Social login
  authProvider: is(is.nullable, is.oneOf('local', 'google', 'github', 'microsoft', 'apple')),
  externalId: is(is.nullable, is.string()),
  
  // Future: MFA
  mfaEnabled: is.bool,
  mfaType: is(is.nullable, is.oneOf('totp', 'sms', 'email')),
  mfaSecret: is(is.nullable, is.string()),  // encrypted
}

// =============================================================================
// General Validators
// =============================================================================

const validatePassword = is.password({ 
  minLength: 8, 
  requireUppercase: false, 
  requireLowercase: false, 
  requireNumber: false 
})

const validateUserIdOrUsername = is.refine(
  is.object({
    userId: is(is.optional, baseSchema.userId),
    username: is(is.optional, baseSchema.username),
  }),
  (data) => data.userId !== undefined || data.username !== undefined,
  'At least one of userId or username is required'
)

// =============================================================================
// Action Validators Factory
// =============================================================================

/**
 * Create all action validators based on configuration
 * 
 * @returns {Object} Object containing all action validators
 */
export function createActionValidators() {

  // Create (admin without password OR self-signup with password)
  const validateCreate = createValidator({
    username: baseSchema.username,
    email: baseSchema.email,
    phone: baseSchema.phone,
    role: baseSchema.role,
    permissions: baseSchema.permissions,
    password: is(is.optional, validatePassword),
    isActive: is(is.optional, baseSchema.isActive),
  }, { name: 'CreateUser' })

  // Register with token (complete registration)
  const validateRegister = createValidator({
    userId: is(is.optional, baseSchema.userId),
    username: is(is.optional, baseSchema.username),
    token: is.string({ minLength: 1 }),
    password: validatePassword,
  }, { name: 'RegisterUser' })

  // Verify with token (complete registration)
  const validateVerify = createValidator({
    ...validateUserIdOrUsername,
    token: is.string({ minLength: 1 }),
    // optional password - user may have created it and they are just verifying contact info
    // we need to make sure it is created already
    password: is(is.optional, validatePassword),
  }, { name: 'VerifyUser' })

  // Get: requires at least one identifier
  const validateGet = createValidator(
    validateUserIdOrUsername,
    { name: 'GetUser' }
  )

  // Update: requires userId or username, optional other fields
  const validateUpdate = createValidator({
    ...validateUserIdOrUsername,
    email: baseSchema.email,
    phone: baseSchema.phone,
    role: baseSchema.role,
    permissions: baseSchema.permissions,
    isActive: is(is.optional, baseSchema.isActive),
    // Note: isRegistered and isVerified are managed by specific actions, not general update
  }, { name: 'UpdateUser' })

  // Remove: requires at least one identifier
  const validateRemove = createValidator(
    validateUserIdOrUsername,
    { name: 'RemoveUser' }
  )

  // Generate token: requires userId
  const validateGenerateToken = createValidator({
    userId: baseSchema.userId,
    expiresIn: is(is.optional, is.int({ positive: true })),  // ms
  }, { name: 'GenerateToken' })

  // Check password: requires username and password
  const validateCheckPassword = createValidator({
    username: baseSchema.username,
    password: validatePassword,
  }, { name: 'CheckPassword' })

  return {
    validateCreate,
    validateGet,
    validateUpdate,
    validateRemove,
    validateRegister,
    validateVerify,
    validateGenerateToken,
    validateCheckPassword,
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
