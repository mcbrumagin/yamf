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


const profileString = (maxLength) => is(is.optional, is.string({ maxLength }))

const baseSchema = {
  // Core identity
  userId: is.int({ positive: true }),       // SERIAL PRIMARY KEY
  username: is.anyOf(is.email, is.regex(/^[a-zA-Z0-9_-]+$/, { minLength: 3 })),
  email: is(is.optional, is.email),
  phone: is(is.optional, is.phone),

  displayName: profileString(200),
  bio: profileString(4000),
  location: profileString(500),
  avatarPath: profileString(1024),
  invitedBy: is(is.optional, is.int({ positive: true })),
  latitude: is(is.optional, is.number),
  longitude: is(is.optional, is.number),
  
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

function refineLatitudeLongitudeTogether(data) {
  const hasLat = data.latitude !== undefined && data.latitude !== null
  const hasLon = data.longitude !== undefined && data.longitude !== null
  if (hasLat !== hasLon) {
    return 'latitude and longitude must both be provided or both omitted'
  }
  return true
}

// =============================================================================
// Action Validators Factory
// =============================================================================

/**
 * Create all action validators based on configuration
 * 
 * @returns {Object} Object containing all action validators
 */
export function createActionValidators() {

  // Create: self-signup only (username + password). Use invite for pending registration rows.
  const _validateCreate = createValidator({
    username: baseSchema.username,
    password: validatePassword,
    email: baseSchema.email,
    phone: baseSchema.phone,
    role: baseSchema.role,
    permissions: baseSchema.permissions,
    isActive: is(is.optional, baseSchema.isActive),
    displayName: baseSchema.displayName,
    bio: baseSchema.bio,
    location: baseSchema.location,
    avatarPath: baseSchema.avatarPath,
    invitedBy: baseSchema.invitedBy,
    latitude: baseSchema.latitude,
    longitude: baseSchema.longitude,
  }, { name: 'CreateUser' })

  const validateCreate = (data) => {
    const parsed = _validateCreate(data)
    const geo = refineLatitudeLongitudeTogether(parsed)
    if (geo !== true) {
      throw new ValidationError(
        [{ path: 'latitude', constraint: 'together', message: geo }],
        'CreateUser'
      )
    }
    return parsed
  }

  // Invite: pending registration (optional username); never includes password
  const _validateInvite = createValidator({
    username: is(is.optional, baseSchema.username),
    email: baseSchema.email,
    phone: baseSchema.phone,
    role: baseSchema.role,
    permissions: baseSchema.permissions,
    isActive: is(is.optional, baseSchema.isActive),
    displayName: baseSchema.displayName,
    bio: baseSchema.bio,
    location: baseSchema.location,
    avatarPath: baseSchema.avatarPath,
    invitedBy: baseSchema.invitedBy,
    latitude: baseSchema.latitude,
    longitude: baseSchema.longitude,
  }, { name: 'InviteUser' })

  const validateInvite = (data) => {
    if (data && data.password !== undefined && data.password !== null) {
      throw new ValidationError(
        [{ path: 'password', constraint: 'forbidden', message: 'use create with password for self-signup; invite must not include a password' }],
        'InviteUser'
      )
    }
    const parsed = _validateInvite(data)
    const geo = refineLatitudeLongitudeTogether(parsed)
    if (geo !== true) {
      throw new ValidationError(
        [{ path: 'latitude', constraint: 'together', message: geo }],
        'InviteUser'
      )
    }
    return parsed
  }

  // Register with token (complete registration)
  const _validateRegister = createValidator({
    userId: is(is.optional, baseSchema.userId),
    username: is(is.optional, baseSchema.username),
    token: is.string({ minLength: 1 }),
    password: validatePassword,
    displayName: baseSchema.displayName,
    bio: baseSchema.bio,
    location: baseSchema.location,
    avatarPath: baseSchema.avatarPath,
    latitude: baseSchema.latitude,
    longitude: baseSchema.longitude,
  }, { name: 'RegisterUser' })

  const validateRegister = (data) => {
    const parsed = _validateRegister(data)
    const geo = refineLatitudeLongitudeTogether(parsed)
    if (geo !== true) {
      throw new ValidationError(
        [{ path: 'latitude', constraint: 'together', message: geo }],
        'RegisterUser'
      )
    }
    return parsed
  }

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
  const _validateUpdate = createValidator({
    ...validateUserIdOrUsername,
    email: baseSchema.email,
    phone: baseSchema.phone,
    role: baseSchema.role,
    permissions: baseSchema.permissions,
    isActive: is(is.optional, baseSchema.isActive),
    displayName: baseSchema.displayName,
    bio: baseSchema.bio,
    location: baseSchema.location,
    avatarPath: baseSchema.avatarPath,
    latitude: baseSchema.latitude,
    longitude: baseSchema.longitude,
    // Note: isRegistered and isVerified are managed by specific actions, not general update
  }, { name: 'UpdateUser' })

  const validateUpdate = (data) => {
    const parsed = _validateUpdate(data)
    const geo = refineLatitudeLongitudeTogether(parsed)
    if (geo !== true) {
      throw new ValidationError(
        [{ path: 'latitude', constraint: 'together', message: geo }],
        'UpdateUser'
      )
    }
    return parsed
  }

  const validateCleanupInvites = (data) => {
    if (data != null && typeof data !== 'object') {
      throw new ValidationError(
        [{ path: '', constraint: 'type', message: 'Expected an object (or omit cleanupInvites payload)' }],
        'CleanupInvites'
      )
    }
    return data ?? {}
  }

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
    validateInvite,
    validateGet,
    validateUpdate,
    validateRemove,
    validateRegister,
    validateVerify,
    validateGenerateToken,
    validateCheckPassword,
    validateCleanupInvites,
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
