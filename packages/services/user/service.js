/**
 * User Service
 * 
 * Comprehensive user management service with:
 * - Flexible username validation (email, pattern, or custom)
 * - Admin-created accounts with registration tokens
 * - Self-signup with password (requires verification)
 * - Token-based registration completion
 * - Email/identity verification
 * - Lifecycle date tracking
 * - Future-proof fields for social login and MFA
 */

import {
  createService,
  callService,
  Logger,
  HttpError,
  next,
  envConfig
} from '@yamf/core'

import {
  createArgonSaltAndHash,
  checkArgonPassword
} from '@yamf/core/crypto'

import {
  createUsernameValidator,
  createActionValidators,
  createValidationError,
  ValidationError
} from './validators.js'

import {
  generateRegistrationToken,
  verifyRegistrationToken,
  calculateTokenExpiry,
  isTokenExpired
} from './token.js'

const logger = new Logger({ logGroup: 'user-service' })

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG = {
  serviceName: 'user-service',
  dataService: 'postgres-service',
  
  // Username validation
  usernameValidation: {
    type: 'email',  // 'email' | 'pattern' | 'custom' | 'any'
    pattern: null,
    validate: null,
    message: null,
  },
  
  // Registration token settings
  registrationToken: {
    defaultExpiry: 48 * 60 * 60 * 1000,  // 48 hours in ms
    length: 32,                           // bytes
  },
  
  // Lifecycle hooks
  hooks: {
    onTokenGenerated: null,  // async (userId, token) => {}
    onRegistered: null,      // async (user) => {}
    onVerified: null,        // async (user) => {}
  },
}

// =============================================================================
// Table Setup
// =============================================================================

async function createOrValidateUserTable(sql) {
  await sql(`DROP TABLE IF EXISTS yamf.user`) // TODO REMOVE
  // Create table with all columns
  let createResult = await sql(`
    CREATE TABLE IF NOT EXISTS yamf.user (
      -- Core identity
      user_id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      
      -- Authentication
      hash TEXT NULL,
      salt TEXT NULL,
      
      -- Status flags
      is_registered BOOL DEFAULT FALSE,
      is_active BOOL DEFAULT FALSE,
      is_verified BOOL DEFAULT FALSE,
      
      -- Lifecycle dates
      created_on TIMESTAMPTZ DEFAULT NOW(),
      registered_on TIMESTAMPTZ NULL,
      verified_on TIMESTAMPTZ NULL,
      username_updated_on TIMESTAMPTZ NULL,
      
      -- Registration token (hashed)
      registration_token_hash TEXT NULL,
      registration_token_salt TEXT NULL,
      registration_token_expires TIMESTAMPTZ NULL,
      
      -- Future: Social login
      auth_provider TEXT NULL,
      external_id TEXT NULL,
      
      -- Future: MFA
      mfa_enabled BOOL DEFAULT FALSE,
      mfa_type TEXT NULL,
      mfa_secret TEXT NULL
    )
  `)
  
  logger.debug('Created yamf.user table', createResult)
}

// =============================================================================
// Action Handlers
// =============================================================================

/**
 * Create a new user
 * 
 * Two modes:
 * 1. With password: Self-signup, is_registered=true, is_verified=false
 * 2. Without password: Admin creates, generates registration token
 * 
 * @returns {Object} Created user info (and registrationToken if no password)
 */
async function createUser(sql, create, validators, config, hooks) {
  if (!create) return null

  // Validate input
  try {
    create = validators.validateCreate(create)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('create', err)
    }
    throw err
  }

  const { username, password, isActive = false } = create
  const now = new Date().toISOString()

  let hash = null
  let salt = null
  let isRegistered = false
  let registrationToken = null
  let registrationTokenHash = null
  let registrationTokenSalt = null
  let registrationTokenExpires = null

  if (password) {
    // Self-signup with password
    const credentials = await createArgonSaltAndHash(password)
    hash = credentials.hash
    salt = credentials.salt
    isRegistered = true
    // Not verified yet - needs email verification
  } else {
    // Admin-created without password - generate registration token
    const tokenData = await generateRegistrationToken(config.registrationToken.length)
    registrationToken = tokenData.token  // Return to caller once
    registrationTokenHash = tokenData.hash
    registrationTokenSalt = tokenData.salt
    registrationTokenExpires = calculateTokenExpiry(config.registrationToken.defaultExpiry)?.toISOString() || null
  }

  // Insert user
  let [user] = await sql(`
    INSERT INTO yamf.user (
      username, hash, salt, 
      is_registered, is_active, is_verified,
      created_on,
      registration_token_hash, registration_token_salt, registration_token_expires,
      auth_provider, mfa_enabled
    )
    VALUES (
      :username, :hash, :salt,
      :isRegistered, :isActive, :isVerified,
      :createdOn,
      :registrationTokenHash, :registrationTokenSalt, :registrationTokenExpires,
      :authProvider, :mfaEnabled
    )
    RETURNING user_id, username, is_registered, is_active, is_verified, created_on
  `, {
    username,
    hash,
    salt,
    isRegistered,
    isActive,
    isVerified: false,
    createdOn: now,
    registrationTokenHash,
    registrationTokenSalt,
    registrationTokenExpires,
    authProvider: 'local',
    mfaEnabled: false,
  })

  logger.debug('Created yamf.user:', user)

  // Call hook if token was generated
  if (registrationToken && hooks.onTokenGenerated) {
    try {
      await hooks.onTokenGenerated(user.userId, registrationToken)
    } catch (err) {
      logger.error('onTokenGenerated hook error:', err)
    }
  }

  // Return result (include token only if generated)
  const result = { ...user }
  if (registrationToken) {
    result.registrationToken = registrationToken  // Shown once!
  }
  
  return result
}

/**
 * Register with token - complete registration for admin-created accounts
 * 
 * @param {Object} register - { token, password }
 * @returns {Object} Updated user info
 */
async function registerWithToken(sql, register, validators, config, hooks) {
  if (!register) return null

  // Validate input
  try {
    register = validators.validateRegisterWithToken(register)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('register', err)
    }
    throw err
  }

  const { token, password } = register

  // Find user by iterating through users with tokens
  // (We can't query by token directly since it's hashed)
  let [users] = await sql(`
    SELECT user_id, username, 
           registration_token_hash,
           registration_token_salt,
           registration_token_expires,
           is_registered
    FROM yamf.user
    WHERE registration_token_hash IS NOT NULL
  `, {})

  // Ensure users is an array
  if (!Array.isArray(users)) {
    users = users ? [users] : []
  }

  let matchedUser = null
  for (const user of users) {
    if (user.isRegistered) continue  // Skip already registered users
    
    // Check if token has expired
    if (isTokenExpired(user.registrationTokenExpires)) continue
    
    // Verify token
    const isValid = await verifyRegistrationToken(
      token, 
      user.registrationTokenHash, 
      user.registrationTokenSalt
    )
    
    if (isValid) {
      matchedUser = user
      break
    }
  }

  if (!matchedUser) {
    throw new HttpError(401, 'Invalid or expired registration token')
  }

  // Hash the new password
  const { hash, salt } = await createArgonSaltAndHash(password)
  const now = new Date().toISOString()

  // Update user: set password, clear token, mark registered and verified
  let [updatedUser] = await sql(`
    UPDATE yamf.user
    SET 
      hash = :hash,
      salt = :salt,
      is_registered = TRUE,
      is_verified = TRUE,
      registered_on = :registeredOn,
      verified_on = :verifiedOn,
      registration_token_hash = NULL,
      registration_token_salt = NULL,
      registration_token_expires = NULL
    WHERE user_id = :userId
    RETURNING user_id, username, is_registered, is_active, is_verified, registered_on, verified_on
  `, {
    hash,
    salt,
    registeredOn: now,
    verifiedOn: now,
    userId: matchedUser.userId,
  })

  logger.debug('Registered yamf.user with token:', updatedUser)

  // Call hook
  if (hooks.onRegistered) {
    try {
      await hooks.onRegistered(updatedUser)
    } catch (err) {
      logger.error('onRegistered hook error:', err)
    }
  }

  return updatedUser
}

/**
 * Verify a user (for self-signup users who need email verification)
 * 
 * @param {Object} verify - { userId } or { token }
 * @returns {Object} Updated user info
 */
async function verifyUser(sql, verify, validators, config, hooks) {
  if (!verify) return null

  // Validate input
  try {
    verify = validators.validateVerify(verify)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('verify', err)
    }
    throw err
  }

  const { userId, token } = verify
  const now = new Date().toISOString()

  let targetUserId = userId

  // If verifying by token, find the user
  if (token && !userId) {
    // Similar to registerWithToken, we need to check all users with tokens
    let [users] = await sql(`
      SELECT user_id, registration_token_hash, registration_token_salt, registration_token_expires
      FROM yamf.user
      WHERE registration_token_hash IS NOT NULL AND is_verified = FALSE
    `, {})

    if (!Array.isArray(users)) {
      users = users ? [users] : []
    }

    for (const user of users) {
      if (isTokenExpired(user.registrationTokenExpires)) continue
      
      const isValid = await verifyRegistrationToken(
        token,
        user.registrationTokenHash,
        user.registrationTokenSalt
      )
      
      if (isValid) {
        targetUserId = user.userId
        break
      }
    }

    if (!targetUserId) {
      throw new HttpError(401, 'Invalid or expired verification token')
    }
  }

  // Update user
  let [updatedUser] = await sql(`
    UPDATE yamf.user
    SET 
      is_verified = TRUE,
      verified_on = :verifiedOn,
      registration_token_hash = NULL,
      registration_token_salt = NULL,
      registration_token_expires = NULL
    WHERE user_id = :userId
    RETURNING user_id, username, is_registered, is_active, is_verified, verified_on
  `, {
    verifiedOn: now,
    userId: targetUserId,
  })

  logger.debug('Verified yamf.user:', updatedUser)

  // Call hook
  if (hooks.onVerified) {
    try {
      await hooks.onVerified(updatedUser)
    } catch (err) {
      logger.error('onVerified hook error:', err)
    }
  }

  return updatedUser
}

/**
 * Generate a new registration token for a user
 * 
 * @param {Object} generateToken - { userId, expiresIn? }
 * @returns {Object} { userId, registrationToken }
 */
async function generateToken(sql, generateTokenData, validators, config, hooks) {
  if (!generateTokenData) return null

  // Validate input
  try {
    generateTokenData = validators.validateGenerateToken(generateTokenData)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('generateToken', err)
    }
    throw err
  }

  const { userId, expiresIn } = generateTokenData
  const expiry = expiresIn !== undefined ? expiresIn : config.registrationToken.defaultExpiry

  // Generate new token
  const tokenData = await generateRegistrationToken(config.registrationToken.length)
  const expiresAt = calculateTokenExpiry(expiry)?.toISOString() || null

  // Update user with new token
  let [user] = await sql(`
    UPDATE yamf.user
    SET 
      registration_token_hash = :tokenHash,
      registration_token_salt = :tokenSalt,
      registration_token_expires = :tokenExpires
    WHERE user_id = :userId
    RETURNING user_id, username
  `, {
    tokenHash: tokenData.hash,
    tokenSalt: tokenData.salt,
    tokenExpires: expiresAt,
    userId,
  })

  if (!user) {
    throw new HttpError(404, 'User not found')
  }

  logger.debug('Generated new token for yamf.user:', user.userId)

  // Call hook
  if (hooks.onTokenGenerated) {
    try {
      await hooks.onTokenGenerated(user.userId, tokenData.token)
    } catch (err) {
      logger.error('onTokenGenerated hook error:', err)
    }
  }

  return {
    userId: user.userId,
    username: user.username,
    registrationToken: tokenData.token,  // Shown once!
    expiresAt,
  }
}

/**
 * Get a user by ID or username
 */
async function getUser(sql, get, validators) {
  if (!get) return null

  // Validate input
  try {
    get = validators.validateGet(get)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('get', err)
    }
    throw err
  }

  const { userId = null, username = null } = get

  // Select non-sensitive fields only
  let [user] = await sql(`
    SELECT 
      user_id, username,
      is_registered, is_active, is_verified,
      created_on, registered_on, verified_on, username_updated_on,
      auth_provider, external_id,
      mfa_enabled, mfa_type
    FROM yamf.user 
    WHERE user_id = :userId OR username = :username
  `, { userId, username })

  logger.debug('Read yamf.user:', user, 'for', { userId, username })
  return user
}

/**
 * Update a user
 */
async function updateUser(sql, update, validators) {
  if (!update) return null

  // Validate input
  try {
    update = validators.validateUpdate(update)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('update', err)
    }
    throw err
  }

  const { userId, username = null, isActive = null } = update
  const now = new Date().toISOString()

  // Track username change
  let usernameUpdatedOn = null
  if (username !== null) {
    usernameUpdatedOn = now
  }

  let [user] = await sql(`
    UPDATE yamf.user
    SET
      username = COALESCE(:username, username),
      username_updated_on = COALESCE(:usernameUpdatedOn, username_updated_on),
      is_active = COALESCE(:isActive, is_active)
    WHERE user_id = :userId
    RETURNING user_id, username, is_registered, is_active, is_verified, username_updated_on
  `, { userId, username, usernameUpdatedOn, isActive })

  logger.debug('Updated yamf.user:', user)
  return user
}

/**
 * Remove a user
 */
async function removeUser(sql, remove, validators) {
  if (!remove) return null

  // Validate input
  try {
    remove = validators.validateRemove(remove)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('remove', err)
    }
    throw err
  }

  const { userId = null, username = null } = remove

  let result = await sql(`
    DELETE FROM yamf.user 
    WHERE user_id = :userId OR username = :username
    RETURNING user_id, username
  `, { userId, username })

  logger.debug('Removed yamf.user:', result)
  return result[0] || null
}

// =============================================================================
// Service Factory
// =============================================================================

/**
 * Create a user service with configurable options
 * 
 * @param {Object} options - Service configuration
 * @returns {Promise<Object>} The created service
 */
export default async function createUserService(options = {}) {
  // Merge with defaults
  const config = {
    ...DEFAULT_CONFIG,
    ...options,
    usernameValidation: {
      ...DEFAULT_CONFIG.usernameValidation,
      ...options.usernameValidation,
    },
    registrationToken: {
      ...DEFAULT_CONFIG.registrationToken,
      ...options.registrationToken,
    },
    hooks: {
      ...DEFAULT_CONFIG.hooks,
      ...options.hooks,
    },
  }

  const { serviceName, dataService, hooks } = config

  // Create validators based on configuration
  const usernameValidator = createUsernameValidator(config.usernameValidation)
  const validators = createActionValidators(usernameValidator)

  // Initialize SQL helper and table
  const sql = async (template, data = {}) => callService(dataService, { template, data })
  await createOrValidateUserTable(sql)

  // Create the service
  const service = await createService(serviceName, async function userService(payload) {
    const { create, register, verify, generateToken: genToken, get, update, remove } = payload

    // Check at least one action is provided
    const actions = [create, register, verify, genToken, get, update, remove]
    if (!actions.some(Boolean)) {
      throw new HttpError(400, 'Expected user action: create, register, verify, generateToken, get, update, or remove')
    }

    // Create SQL helper bound to this request context
    const sql = async (template, data = {}) => this.call(dataService, { template, data })

    // Execute actions
    const results = {
      create: create && await createUser(sql, create, validators, config, hooks),
      register: register && await registerWithToken(sql, register, validators, config, hooks),
      verify: verify && await verifyUser(sql, verify, validators, config, hooks),
      generateToken: genToken && await generateToken(sql, genToken, validators, config, hooks),
      update: update && await updateUser(sql, update, validators),
      get: get && await getUser(sql, get, validators),
      remove: remove && await removeUser(sql, remove, validators),
    }

    // Remove null results
    for (const action in results) {
      if (results[action] == null) delete results[action]
    }

    return results
  })

  return service
}
