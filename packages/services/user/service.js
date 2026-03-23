/**
 * User Service
 * 
 * Comprehensive user management service with:
 * - Flexible username validation (email, pattern, or custom)
 * - Invite flow for pending registration (token); explicit invite action
 * - Self-signup via create (username + password; requires verification)
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

function geolocationEwkt(longitude, latitude) {
  if (longitude == null || latitude == null) return null
  return `SRID=4326;POINT(${longitude} ${latitude})`
}

/**
 * Idempotent schema sync for existing databases (new installs get full CREATE TABLE).
 * Geolocation is stored as TEXT (EWKT) so Postgres without PostGIS works; optional cast to GEOGRAPHY in DB migrations.
 */
async function syncUserTableSchema(sql) {
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS email TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS phone TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS display_name TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS bio TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS location TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS geolocation TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS avatar_path TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS invited_by INTEGER NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS hash TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS salt TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS is_registered BOOL DEFAULT FALSE`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS is_active BOOL DEFAULT FALSE`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS is_verified BOOL DEFAULT FALSE`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS role TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS permissions TEXT[] NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS created_on TIMESTAMPTZ DEFAULT NOW()`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS registered_on TIMESTAMPTZ NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS verified_on TIMESTAMPTZ NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS username_updated_on TIMESTAMPTZ NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS user_role_updated_on TIMESTAMPTZ NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS token_hash TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS token_salt TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS token_expires TIMESTAMPTZ NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS auth_provider TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS external_id TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS mfa_enabled BOOL DEFAULT FALSE`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS mfa_type TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ADD COLUMN IF NOT EXISTS mfa_secret TEXT NULL`, {})
  await sql(`ALTER TABLE yamf.user ALTER COLUMN username DROP NOT NULL`, {})

  await sql(`
    CREATE INDEX IF NOT EXISTS idx_user_expired_invite_cleanup
    ON yamf.user (token_expires)
    WHERE is_registered = FALSE
      AND token_hash IS NOT NULL
      AND token_expires IS NOT NULL
  `, {})
}

async function createOrValidateUserTable(sql) {
  // await sql(`DROP TABLE IF EXISTS yamf.user`) // TODO REMOVE
  // Create table with all columns
  let createResult = await sql(`
    CREATE TABLE IF NOT EXISTS yamf.user (
      -- Core identity
      user_id SERIAL PRIMARY KEY,
      username TEXT NULL UNIQUE,
      email TEXT NULL UNIQUE,
      phone TEXT NULL UNIQUE,

      display_name TEXT NULL,
      bio TEXT NULL,
      location TEXT NULL,
      geolocation TEXT NULL,
      avatar_path TEXT NULL,
      invited_by INTEGER NULL REFERENCES yamf.user(user_id) ON DELETE SET NULL,

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
  `, {})

  await syncUserTableSchema(sql)
  
  logger.info('Created yamf.user table', createResult)
}

// =============================================================================
// Action Handlers
// =============================================================================

async function insertPendingInviteRow(sql, fields, config) {
  const {
    username = null,
    role = null,
    permissions = null,
    isActive = false,
    displayName = null,
    bio = null,
    location = null,
    avatarPath = null,
    invitedBy = null,
    latitude = null,
    longitude = null,
  } = fields

  const now = new Date().toISOString()
  const tokenData = await generateRegistrationToken(config.registrationToken.length)
  const tokenExpires = calculateTokenExpiry(config.registrationToken.defaultExpiry)?.toISOString() || null
  const geolocationEwktParam = geolocationEwkt(longitude, latitude) ?? ''
  const permissionsParam = permissions ?? []

  let [user] = await sql(`
    INSERT INTO yamf.user (
      username, role, permissions,
      display_name, bio, location, geolocation, avatar_path, invited_by,
      hash, salt,
      is_registered, is_active, is_verified,
      created_on,
      token_hash, token_salt, token_expires,
      auth_provider, mfa_enabled
    )
    VALUES (
      NULLIF(CAST(:username AS TEXT), ''),
      NULLIF(CAST(:role AS TEXT), ''),
      CAST(:permissions AS TEXT[]),
      NULLIF(CAST(:displayName AS TEXT), ''),
      NULLIF(CAST(:bio AS TEXT), ''),
      NULLIF(CAST(:location AS TEXT), ''),
      NULLIF(CAST(:geolocationEwkt AS TEXT), ''),
      NULLIF(CAST(:avatarPath AS TEXT), ''),
      CAST(:invitedBy AS INTEGER),
      NULL, NULL,
      FALSE, CAST(:isActive AS BOOLEAN), FALSE,
      CAST(:createdOn AS TIMESTAMPTZ),
      CAST(:tokenHash AS TEXT), CAST(:tokenSalt AS TEXT), CAST(:tokenExpires AS TIMESTAMPTZ),
      'local', FALSE
    )
    RETURNING user_id, username, role, permissions, is_registered, is_active, is_verified, created_on,
      display_name, bio, location, avatar_path, invited_by
  `, {
    username: username ?? '',
    role: role ?? '',
    permissions: permissionsParam,
    displayName: displayName ?? '',
    bio: bio ?? '',
    location: location ?? '',
    geolocationEwkt: geolocationEwktParam,
    avatarPath: avatarPath ?? '',
    invitedBy,
    createdOn: now,
    tokenHash: tokenData.hash,
    tokenSalt: tokenData.salt,
    tokenExpires,
    isActive,
  })

  logger.debug('Inserted pending invite yamf.user:', user)
  return { user, tokenPlain: tokenData.token }
}

/**
 * Explicit invite-only action (no password). Pending row until register completes.
 */
async function inviteUser(sql, invite, validators, config) {
  if (!invite) return null

  try {
    invite = validators.validateInvite(invite)
    logger.info(`Invite user row: ${invite.username ?? '(username set at registration)'}`)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('invite', err)
    }
    throw err
  }

  const { user, tokenPlain } = await insertPendingInviteRow(sql, invite, config)
  const result = { ...user }
  if (tokenPlain) result.token = tokenPlain
  return result
}

/**
 * Self-signup: new user with username and password (is_registered=true, is_verified=false).
 * For invites (token, optional username), use {@link inviteUser}.
 *
 * @returns {Object} Created user info (no registration token)
 */
async function createUser(sql, create, validators, _config) {
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

  const {
    username,
    password,
    role = null,
    permissions = null,
    isActive = false,
    displayName = null,
    bio = null,
    location = null,
    avatarPath = null,
    invitedBy = null,
    latitude = null,
    longitude = null,
  } = create

  const now = new Date().toISOString()
  const credentials = await createArgonSaltAndHash(password)
  const hash = credentials.hash
  const salt = credentials.salt
  const geolocationEwktParam = geolocationEwkt(longitude, latitude) ?? ''
  const permissionsParam = permissions ?? []

  let [user] = await sql(`
    INSERT INTO yamf.user (
      username, role, permissions,
      display_name, bio, location, geolocation, avatar_path, invited_by,
      hash, salt,
      is_registered, is_active, is_verified,
      created_on,
      token_hash, token_salt, token_expires,
      auth_provider, mfa_enabled
    )
    VALUES (
      NULLIF(CAST(:username AS TEXT), ''),
      NULLIF(CAST(:role AS TEXT), ''),
      CAST(:permissions AS TEXT[]),
      NULLIF(CAST(:displayName AS TEXT), ''),
      NULLIF(CAST(:bio AS TEXT), ''),
      NULLIF(CAST(:location AS TEXT), ''),
      NULLIF(CAST(:geolocationEwkt AS TEXT), ''),
      NULLIF(CAST(:avatarPath AS TEXT), ''),
      CAST(:invitedBy AS INTEGER),
      CAST(:hash AS TEXT), CAST(:salt AS TEXT),
      TRUE, CAST(:isActive AS BOOLEAN), FALSE,
      CAST(:createdOn AS TIMESTAMPTZ),
      NULL, NULL, NULL,
      'local', FALSE
    )
    RETURNING user_id, username, role, permissions, is_registered, is_active, is_verified, created_on,
      display_name, bio, location, avatar_path, invited_by
  `, {
    username: username ?? '',
    role: role ?? '',
    permissions: permissionsParam,
    displayName: displayName ?? '',
    bio: bio ?? '',
    location: location ?? '',
    geolocationEwkt: geolocationEwktParam,
    avatarPath: avatarPath ?? '',
    invitedBy,
    hash,
    salt,
    isActive,
    isVerified: false,
    createdOn: now,
  })

  logger.debug('Created yamf.user (self-signup):', user)
  return { ...user }
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

  const {
    token,
    password,
    username: payloadUsername = null,
    displayName = null,
    bio = null,
    location = null,
    avatarPath = null,
    latitude = null,
    longitude = null,
  } = payload

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

  const hadUsername = matchedUser.username != null && matchedUser.username !== ''
  if (!hadUsername && (payloadUsername == null || payloadUsername === '')) {
    throw new HttpError(400, 'username is required to complete registration for this invite')
  }
  if (
    hadUsername &&
    payloadUsername != null &&
    payloadUsername !== '' &&
    payloadUsername !== matchedUser.username
  ) {
    throw new HttpError(400, 'username cannot be changed during token registration')
  }

  const usernameFinal = hadUsername ? matchedUser.username : payloadUsername
  const usernameUpdatedOn = !hadUsername ? new Date().toISOString() : null
  const geolocationEwktParam = geolocationEwkt(longitude, latitude) ?? ''

  // Hash the new password
  const { hash, salt } = await createArgonSaltAndHash(password)
  const now = new Date().toISOString()

  // Update user: set password, clear token, mark registered and verified
  let [updatedUser] = await sql(`
    UPDATE yamf.user
    SET 
      username = CAST(:usernameFinal AS TEXT),
      username_updated_on = COALESCE(CAST(:usernameUpdatedOn AS TIMESTAMPTZ), username_updated_on),
      display_name = COALESCE(NULLIF(CAST(:displayName AS TEXT), ''), display_name),
      bio = COALESCE(NULLIF(CAST(:bio AS TEXT), ''), bio),
      location = COALESCE(NULLIF(CAST(:location AS TEXT), ''), location),
      avatar_path = COALESCE(NULLIF(CAST(:avatarPath AS TEXT), ''), avatar_path),
      geolocation = COALESCE(NULLIF(CAST(:geolocationEwkt AS TEXT), ''), geolocation),
      hash = :hash,
      salt = :salt,
      is_registered = TRUE,
      is_verified = TRUE,
      registered_on = :registeredOn,
      verified_on = :verifiedOn,
      token_hash = NULL,
      token_salt = NULL,
      token_expires = NULL
    WHERE user_id = CAST(:userId AS INTEGER)
    RETURNING user_id, username, is_registered, is_active, is_verified, registered_on, verified_on,
      display_name, bio, location, avatar_path
  `, {
    usernameFinal,
    usernameUpdatedOn,
    displayName: displayName ?? '',
    bio: bio ?? '',
    location: location ?? '',
    avatarPath: avatarPath ?? '',
    geolocationEwkt: geolocationEwktParam,
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

  const [existingUser] = userId != null
    ? await sql(`
    SELECT user_id, username, hash, salt FROM yamf.user
    WHERE user_id = CAST(:userId AS INTEGER)
  `, { userId })
    : await sql(`
    SELECT user_id, username, hash, salt FROM yamf.user
    WHERE username = CAST(:username AS TEXT)
  `, { username })

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
  const verifyUpdateData = {
    verifiedOn: now,
    hash: newCredentials?.hash || existingUser.hash,
    salt: newCredentials?.salt || existingUser.salt,
  }
  const [updatedUser] = userId != null
    ? await sql(`
    UPDATE yamf.user
    SET 
      is_verified = TRUE,
      verified_on = CAST(:verifiedOn AS TIMESTAMPTZ),
      is_registered = TRUE,
      registered_on = CAST(:verifiedOn AS TIMESTAMPTZ),
      hash = CAST(:hash AS TEXT),
      salt = CAST(:salt AS TEXT)
    WHERE user_id = CAST(:userId AS INTEGER)
    RETURNING user_id, username, is_registered, is_active, is_verified, verified_on, registered_on
  `, { ...verifyUpdateData, userId })
    : await sql(`
    UPDATE yamf.user
    SET 
      is_verified = TRUE,
      verified_on = CAST(:verifiedOn AS TIMESTAMPTZ),
      is_registered = TRUE,
      registered_on = CAST(:verifiedOn AS TIMESTAMPTZ),
      hash = CAST(:hash AS TEXT),
      salt = CAST(:salt AS TEXT)
    WHERE username = CAST(:username AS TEXT)
    RETURNING user_id, username, is_registered, is_active, is_verified, verified_on, registered_on
  `, { ...verifyUpdateData, username })

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
    WHERE user_id = CAST(:userId AS INTEGER)
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
    SELECT user_id, username, hash, salt FROM yamf.user WHERE username = CAST(:username AS TEXT)
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
  const [user] = userId != null
    ? await sql(`
    SELECT 
      user_id, username,
      display_name, bio, location, avatar_path,
      geolocation,
      invited_by,
      role, permissions,
      is_registered, is_active, is_verified,
      created_on, registered_on, verified_on, username_updated_on,
      auth_provider, external_id,
      mfa_enabled, mfa_type
    FROM yamf.user 
    WHERE user_id = CAST(:userId AS INTEGER)
  `, { userId })
    : await sql(`
    SELECT 
      user_id, username,
      display_name, bio, location, avatar_path,
      geolocation,
      invited_by,
      role, permissions,
      is_registered, is_active, is_verified,
      created_on, registered_on, verified_on, username_updated_on,
      auth_provider, external_id,
      mfa_enabled, mfa_type
    FROM yamf.user 
    WHERE username = CAST(:username AS TEXT)
  `, { username })

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

  const {
    userId,
    username = null,
    role = null,
    permissions = null,
    isActive = null,
    displayName = null,
    bio = null,
    location = null,
    avatarPath = null,
    latitude = null,
    longitude = null,
  } = update
  const now = new Date().toISOString()
  const geolocationEwktParam = geolocationEwkt(longitude, latitude) ?? ''
  const permissionsParam = permissions ?? []

  // Track username change
  let usernameUpdatedOn = null
  if (username !== null) {
    usernameUpdatedOn = now
  }

  let [user] = await sql(`
    UPDATE yamf.user
    SET
      username = COALESCE(NULLIF(CAST(:username AS TEXT), ''), username),
      username_updated_on = COALESCE(CAST(:usernameUpdatedOn AS TIMESTAMPTZ), username_updated_on),
      role = COALESCE(NULLIF(CAST(:role AS TEXT), ''), role),
      permissions = COALESCE(CAST(:permissions AS TEXT[]), permissions),
      is_active = COALESCE(CAST(:isActive AS BOOLEAN), is_active),
      display_name = COALESCE(NULLIF(CAST(:displayName AS TEXT), ''), display_name),
      bio = COALESCE(NULLIF(CAST(:bio AS TEXT), ''), bio),
      location = COALESCE(NULLIF(CAST(:location AS TEXT), ''), location),
      avatar_path = COALESCE(NULLIF(CAST(:avatarPath AS TEXT), ''), avatar_path),
      geolocation = COALESCE(NULLIF(CAST(:geolocationEwkt AS TEXT), ''), geolocation)
    WHERE user_id = CAST(:userId AS INTEGER)
    RETURNING user_id, username, role, permissions, is_registered, is_active, is_verified, username_updated_on,
      display_name, bio, location, avatar_path
  `, {
    userId,
    username: username ?? '',
    usernameUpdatedOn,
    role: role ?? '',
    permissions,
    isActive,
    displayName: displayName ?? '',
    bio: bio ?? '',
    location: location ?? '',
    avatarPath: avatarPath ?? '',
    geolocationEwkt: geolocationEwktParam,
  })

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

  const result = userId != null
    ? await sql(`
    DELETE FROM yamf.user 
    WHERE user_id = CAST(:userId AS INTEGER)
    RETURNING user_id, username
  `, { userId })
    : await sql(`
    DELETE FROM yamf.user 
    WHERE username = CAST(:username AS TEXT)
    RETURNING user_id, username
  `, { username })

  logger.debug('Removed yamf.user:', result)
  return result[0] || null
}

/**
 * Delete pending invite rows whose registration token has expired.
 * Only targets unregistered users with a stored token and expiry in the past.
 */
async function cleanupExpiredInvites(sql, cleanupPayload, validators) {
  if (cleanupPayload === undefined || cleanupPayload === null) return null

  try {
    validators.validateCleanupInvites(cleanupPayload)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw createValidationError('cleanupInvites', err)
    }
    throw err
  }

  const deleted = await sql(`
    DELETE FROM yamf.user
    WHERE is_registered = FALSE
      AND token_hash IS NOT NULL
      AND token_expires IS NOT NULL
      AND token_expires < NOW()
    RETURNING user_id
  `, {})

  const rows = Array.isArray(deleted) ? deleted : []
  const deletedUserIds = rows.map((r) => r.userId)
  logger.info(`cleanupExpiredInvites: removed ${deletedUserIds.length} row(s)`)

  return {
    deletedCount: deletedUserIds.length,
    deletedUserIds,
  }
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
    const {
      create,
      invite,
      register,
      verifyAndRegister,
      verify,
      createToken,
      checkPassword,
      get,
      update,
      remove,
      cleanupInvites,
    } = payload

    const cleanupInvitesRequested = Object.prototype.hasOwnProperty.call(payload, 'cleanupInvites')

    // Check at least one action is provided
    const actions = [
      create,
      invite,
      register,
      verifyAndRegister,
      verify,
      createToken,
      checkPassword,
      get,
      update,
      remove,
      cleanupInvitesRequested,
    ]
    if (!actions.some(Boolean)) {
      throw new HttpError(400, 'Expected user action: create, invite, register, verifyAndRegister, verify, createToken, get, update, remove, or cleanupInvites')
    }

    // Create SQL helper bound to this request context
    const sql = async (template, data = null, options = null) => this.call(dataService, { template, data, options })

    // Execute actions (register and verifyAndRegister use same handler - register kept for backward compat)
    const results = {
      register: register && await registerWithToken(sql, register, validators),
      verifyAndRegister: verifyAndRegister && await registerWithToken(sql, verifyAndRegister, validators),
      verify: verify && await verifyWithToken(sql, verify, validators),
      checkPassword: checkPassword && await verifyPassword(sql, checkPassword, validators),
      createToken: createToken && await generateToken(sql, createToken, validators, config),
      get: get && await getUser(sql, get, validators),
      create: create && await createUser(sql, create, validators, config),
      invite: invite && await inviteUser(sql, invite, validators, config),
      update: update && await updateUser(sql, update, validators),
      remove: remove && await removeUser(sql, remove, validators),
      cleanupInvites: cleanupInvitesRequested && await cleanupExpiredInvites(sql, cleanupInvites ?? {}, validators),
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
