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
  dataService: 'postgres-service'
}

// =============================================================================
// Table Setup
// =============================================================================

async function createOrValidateUserTable(sql) {
  // await sql(`DROP TABLE IF EXISTS yamf.user`) // TODO REMOVE
  // Create table with all columns
  let createResult = await sql(`
    CREATE TABLE IF NOT EXISTS yamf.user (
      -- Core identity
      user_id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NULL UNIQUE,
      phone TEXT NULL UNIQUE,

      -- Authentication
      hash TEXT NULL,
      salt TEXT NULL,
      
      -- Status flags
      is_registered BOOL DEFAULT FALSE,
      is_active BOOL DEFAULT FALSE,
      is_verified BOOL DEFAULT FALSE,

      -- Role & Permissions
      role TEXT NULL,
      permissions TEXT[] NULL,
      
      -- Lifecycle dates
      created_on TIMESTAMPTZ DEFAULT NOW(),
      registered_on TIMESTAMPTZ NULL,
      verified_on TIMESTAMPTZ NULL,
      username_updated_on TIMESTAMPTZ NULL,
      user_role_updated_on TIMESTAMPTZ NULL,
      
      -- Token (hashed): registration or verification - unified field
      token_hash TEXT NULL,
      token_salt TEXT NULL,
      token_expires TIMESTAMPTZ NULL,
      
      -- Future: Social login
      auth_provider TEXT NULL,
      external_id TEXT NULL,
      
      -- Future: MFA
      mfa_enabled BOOL DEFAULT FALSE,
      mfa_type TEXT NULL,
      mfa_secret TEXT NULL
    )
  `)
  
  logger.info('Created yamf.user table', createResult)
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
 * @returns {Object} Created user info (and token if no password)
 */
async function createUser(sql, create, validators, config) {
  if (!create) return null

  // Validate input
  try {
    create = validators.validateCreate(create)
    logger.info(`Creating user: ${create.username}`)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('create', err)
    }
    throw err
  }

  const { username, password, role = null, permissions = null, isActive = false } = create
  const now = new Date().toISOString()

  let hash = null
  let salt = null
  let isRegistered = false
  let tokenPlain = null
  let tokenHash = null
  let tokenSalt = null
  let tokenExpires = null

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
    tokenPlain = tokenData.token  // Return to caller once
    tokenHash = tokenData.hash
    tokenSalt = tokenData.salt
    tokenExpires = calculateTokenExpiry(config.registrationToken.defaultExpiry)?.toISOString() || null
  }

  // Insert user
  let [user] = await sql(`
    INSERT INTO yamf.user (
      username, role, permissions, hash, salt, 
      is_registered, is_active, is_verified,
      created_on,
      token_hash, token_salt, token_expires,
      auth_provider, mfa_enabled
    )
    VALUES (
      :username, :role, :permissions, :hash, :salt,
      :isRegistered, :isActive, :isVerified,
      :createdOn,
      :tokenHash, :tokenSalt, :tokenExpires,
      :authProvider, :mfaEnabled
    )
    RETURNING user_id, username, role, permissions, is_registered, is_active, is_verified, created_on
  `, {
    username,
    role,
    permissions,
    hash,
    salt,
    isRegistered,
    isActive,
    isVerified: false,
    createdOn: now,
    tokenHash,
    tokenSalt,
    tokenExpires,
    authProvider: 'local',
    mfaEnabled: false,
  })

  logger.debug('Created yamf.user:', user)

  // Return result (include token only if generated)
  const result = { ...user }
  if (tokenPlain) {
    result.token = tokenPlain  // Shown once!
  }
  
  return result
}

/**
 * Verify token and complete registration - sets password, is_registered, is_verified
 * Used for admin-invite (user has token, sets password) or verify-and-register flows.
 *
 * @param {Object} payload - { token, password }
 * @returns {Object} Updated user info
 */
async function registerWithToken(sql, payload, validators) {
  if (!payload) return null

  try {
    payload = validators.validateRegister(payload)
    logger.info(`Registering user: ${payload.userId || payload.username || payload.token}`)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('register', err)
    }
    throw err
  }

  const { token, password } = payload

  // Find user by iterating through users with tokens
  // (We can't query by token directly since it's hashed)
  let [users] = await sql(`
    SELECT user_id, username, 
           token_hash,
           token_salt,
           token_expires,
           is_registered
    FROM yamf.user
    WHERE token_hash IS NOT NULL
  `, {})

  // Ensure users is an array
  if (!Array.isArray(users)) {
    users = users ? [users] : []
  }

  let matchedUser = null
  for (const user of users) {
    if (user.isRegistered) continue  // Skip already registered users

    // Check if token has expired
    if (isTokenExpired(user.tokenExpires)) continue

    // Verify token
    const isValid = await verifyRegistrationToken(
      token,
      user.tokenHash,
      user.tokenSalt
    )

    if (isValid) {
      matchedUser = user
      break
    }
  }

  if (!matchedUser) {
    throw new HttpError(401, 'Invalid or expired token')
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
      token_hash = NULL,
      token_salt = NULL,
      token_expires = NULL
    WHERE user_id = :userId
    RETURNING user_id, username, is_registered, is_active, is_verified, registered_on, verified_on
  `, {
    hash,
    salt,
    registeredOn: now,
    verifiedOn: now,
    userId: matchedUser.userId,
  })

  logger.debug('Verified and registered yamf.user with token:', updatedUser)

  return updatedUser
}

/**
 * Verify a user (for self-signup users who need email verification)
 * 
 * @param {Object} verify - { userId } or { token }
 * @returns {Object} Updated user info
 */
async function verifyWithToken(sql, verify, validators) {
  if (!verify) return null

  // Validate input
  try {
    verify = validators.validateVerify(verify)
    logger.info(`Verifying user: ${verify.userId || verify.username}`)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('verify', err)
    }
    throw err
  }

  const { userId = null, username = null, password = null } = verify

  let [existingUser] = await sql(`
    SELECT user_id, username, hash, salt FROM yamf.user WHERE user_id = :userId OR username = :username
  `, { userId, username })

  if (!existingUser) {
    throw new HttpError(404, 'No user found')
  }

  if (!password && !existingUser.hash) {
    throw new HttpError(400, 'No password provided or hash stored')
  }

  let newCredentials = null
  if (password) newCredentials = await createArgonSaltAndHash(password)

  const now = new Date().toISOString()

  // Update user - greater precedence than register, so also sets is_registered and registered_on
  let [updatedUser] = await sql(`
    UPDATE yamf.user
    SET 
      is_verified = TRUE,
      verified_on = :verifiedOn,
      is_registered = TRUE,
      registered_on = :verifiedOn,
      hash = :hash,
      salt = :salt
    WHERE user_id = :userId OR username = :username
    RETURNING user_id, username, is_registered, is_active, is_verified, verified_on, registered_on
  `, {
    verifiedOn: now,
    userId,
    username,
    hash: newCredentials?.hash || existingUser.hash,
    salt: newCredentials?.salt || existingUser.salt,
  })

  logger.debug('Verified yamf.user:', updatedUser)
  return updatedUser
}

/**
 * Generate a new registration token for a user
 * 
 * @param {Object} generateToken - { userId, expiresIn? }
 * @returns {Object} { userId, token, expiresAt }
 */
async function generateToken(sql, generateTokenData, validators, config) {
  if (!generateTokenData) return null

  // Validate input
  try {
    generateTokenData = validators.validateGenerateToken(generateTokenData)
    logger.info(`Generating token for: ${generateTokenData.userId}`)
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
      token_hash = :tokenHash,
      token_salt = :tokenSalt,
      token_expires = :tokenExpires
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

  return {
    userId: user.userId,
    username: user.username,
    token: tokenData.token,  // Shown once!
    expiresAt,
  }
}

/**
 * Check a user's password
 */
async function verifyPassword(sql, checkPassword, validators) {
  if (!checkPassword) return null

  // Validate input
  try {
    checkPassword = validators.validateCheckPassword(checkPassword)
    logger.info(`Checking password for: ${checkPassword.username}`)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('checkPassword', err)
    }
    throw err
  }

  const { username, password } = checkPassword

  // Select user by username
  let [user] = await sql(`
    SELECT user_id, username, hash, salt FROM yamf.user WHERE username = :username
  `, { username })
  
  if (!user) {
    logger.warn('User not found:', username)
    return false
  }

  const { salt, hash } = user

  return await checkArgonPassword(password, salt, hash)
}

/**
 * Get a user by ID or username
 */
async function getUser(sql, get, validators) {
  if (!get) return null

  // Validate input
  try {
    get = validators.validateGet(get)
    logger.info(`Getting user: ${get.userId || get.username}`)
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
      role, permissions,
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
    logger.info(`Updating user: ${update.userId || update.username}`)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('update', err)
    }
    throw err
  }

  const { userId, username = null, role = null, permissions = null, isActive = null } = update
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
      role = COALESCE(:role, role),
      permissions = COALESCE(:permissions, permissions),
      is_active = COALESCE(:isActive, is_active)
    WHERE user_id = :userId
    RETURNING user_id, username, role, permissions, is_registered, is_active, is_verified, username_updated_on
  `, { userId, username, usernameUpdatedOn, role, permissions, isActive })

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
    logger.info(`Removing user: ${remove.userId || remove.username}`)
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

    registrationToken: {
      defaultExpiry: 48 * 60 * 60 * 1000,  // 48 hours in ms
      length: 32,                           // bytes
    }
  }

  const { serviceName, dataService } = config

  // Create validators based on configuration
  const validators = createActionValidators()

  // Initialize SQL helper and table
  const sql = async (template, data = null, options = null) => callService(dataService, { template, data, options })
  // await createOrValidateUserTable(sql) // TODO REMOVE

  // Create the service
  // TODO default rate-limiting
  // TODO role-based access control (or make private and require an extra public-user-auth service)
  const service = await createService(serviceName, async function userService(payload) {
    logger.debug('userService actions:', Object.keys(payload)) // just log keys so we don't log sensitive data
    const { create, register, verifyAndRegister, verify, createToken, checkPassword, get, update, remove } = payload

    // Check at least one action is provided
    const actions = [create, register, verifyAndRegister, verify, createToken, checkPassword, get, update, remove]
    if (!actions.some(Boolean)) {
      throw new HttpError(400, 'Expected user action: create, register, verifyAndRegister, verify, createToken, get, update, or remove')
    }

    // Create SQL helper bound to this request context
    const sql = async (template, data = null, options = null) => this.call(dataService, { template, data, options })

    // Execute actions (register and verifyAndRegister use same handler - register kept for backward compat)
    const results = {
      register: register && await registerWithToken(sql, register, validators),
      verify: verify && await verifyWithToken(sql, verify, validators),
      checkPassword: checkPassword && await verifyPassword(sql, checkPassword, validators),
      createToken: createToken && await generateToken(sql, createToken, validators, config),
      get: get && await getUser(sql, get, validators),
      create: create && await createUser(sql, create, validators, config),
      update: update && await updateUser(sql, update, validators),
      remove: remove && await removeUser(sql, remove, validators),
    }

    // Remove null results
    for (const action in results) {
      if (results[action] == null) delete results[action]
    }

    return results
  })

  // Switch the db config to an admin user and call this to create the user table initially
  service.createOrValidateUserTable = async () => await createOrValidateUserTable(sql)

  return service
}
