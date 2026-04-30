import {
  createService,
  Logger,
  HttpError,
  next,
  envConfig,
  HEADERS,
  loadOrCreateEd25519KeyPair
} from '@yamf/core'

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { createInMemoryCache } from '@yamf/services-cache'
import { ed25519, calculateSHA256Checksum } from '@yamf/core/crypto'

const logger = new Logger({ logGroup: 'yamf-services' })

/**
 * Reject obviously broken validateUserPassword implementations (e.g. unconditional true).
 * Uses a random UUID for both username and password to avoid colliding with real accounts.
 * Expects strict boolean false (or a throw) for failed auth — not undefined, null, or other truthy/falsy values.
 */
async function assertValidateUserPasswordSanity(validateUserPassword) {
  const probe = randomUUID()
  try {
    const result = await Promise.resolve(validateUserPassword(probe, probe))
    if (result !== true && result !== false) {
      throw new Error(
        'validateUserPassword failed sanity check: must return strict boolean true or false, or throw; rejecting credentials must use false (not undefined, null, or other values)'
      )
    }
    if (result === true) {
      throw new Error(
        'validateUserPassword failed sanity check: must not return true for random probe credentials (often indicates a mis-scoped or unconditional validator)'
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('sanity check')) throw err
    // Any other throw counts as rejecting the probe — OK
  }
}

function defaultKeyDir() {
  return join(envConfig.get('YAMF_HOME', join(process.cwd(), '.yamf')), 'auth')
}

function tokenKeyId(encodedToken) {
  return calculateSHA256Checksum(encodedToken).slice(0, 16)
}

/**
 * @param {Object} opts
 * @param {(username: string, password: string) => Promise<boolean>|boolean} opts.validateUserPassword
 *   Required. Application-supplied credential validator. Must return strict boolean
 *   `true` for valid credentials, strict boolean `false` (or throw) for invalid.
 *   YAMF intentionally ships no default validator — backing your auth with
 *   `ADMIN_USER`/`ADMIN_PASS` env vars is a footgun for v1+.
 * @param {string} [opts.serviceName='auth']
 * @param {boolean|string} [opts.useSessions='refresh-only'] true | 'refresh-only' | false
 * @param {boolean} [opts.ephemeral] default true when NODE_ENV=test
 * @param {number|null} [opts.maxSessionsPerUser] max concurrent refresh sessions per user (null = unlimited)
 */
export default async function createAuthService ({
  serviceName = 'auth',
  useSessions = 'refresh-only',
  validateUserPassword,
  enrichTokenPayload = null,
  keyName = 'default',
  keyDir = defaultKeyDir(),
  ephemeral = process.env.NODE_ENV === 'test' || process.env.YAMF_AUTH_EPHEMERAL === '1',
  accessTokenExpiry = 60000 * 30,
  refreshTokenExpiry = 60000 * 60 * 24,
  maxSessionsPerUser = null,
  sessionMetadataFn = null
} = {}) {
  if (useSessions && useSessions !== true && useSessions !== 'refresh-only') {
    throw new Error('useSessions must be true or "refresh-only"')
  }
  if (maxSessionsPerUser != null && (!Number.isFinite(maxSessionsPerUser) || maxSessionsPerUser < 1)) {
    throw new Error('maxSessionsPerUser must be a positive integer or null')
  }
  if (typeof validateUserPassword !== 'function') {
    throw new TypeError('createAuthService: { validateUserPassword } is required and must be a function')
  }

  await assertValidateUserPasswordSanity(validateUserPassword)

  const { keyPair, kid } = await loadOrCreateEd25519KeyPair({
    keyName,
    keyDir,
    ephemeral
  })

  const minEvict = Math.min(accessTokenExpiry, refreshTokenExpiry)
  const cache = !useSessions
    ? null
    : createInMemoryCache({
      expireTime: minEvict,
      evictionInterval: Math.max(1000, Math.floor(minEvict / 30))
    })

  const encodeBase64 = (data) => Buffer.from(data).toString('base64')
  const decodeBase64 = (data) => Buffer.from(data, 'base64').toString('utf8')

  const createToken = async (user, type = 'access') => {
    const expire = Date.now() + (type === 'access' ? accessTokenExpiry : refreshTokenExpiry)
    const extra = enrichTokenPayload ? await enrichTokenPayload(user) : {}
    const payload = JSON.stringify({ user, expire, kid, ...extra })
    const signature = await ed25519.sign(keyPair, payload)
    logger.debug(`signature: ${signature}`)
    return encodeBase64(`${payload}.${signature}`)
  }

  function assertPayloadKidMatches(payload) {
    if (payload.kid != null && payload.kid !== kid) {
      throw new HttpError(401, 'Invalid access token')
    }
  }

  function evictOldestUserSessionsIfNeeded(user) {
    if (!cache || maxSessionsPerUser == null) return
    const all = cache.get('*')
    if (!all || typeof all !== 'object') return
    const rows = Object.keys(all)
      .filter((k) => k.startsWith('refresh:') && all[k]?.user === user)
      .map((k) => ({ k, t: all[k].createdAt || 0 }))
      .sort((a, b) => a.t - b.t)
    while (rows.length >= maxSessionsPerUser) {
      const row = rows.shift()
      if (row) cache.del(row.k)
    }
  }

  const authenticate = async (payload, request, response) => {
    logger.debug(`authenticating user ${payload.user}`)

    const isValid = await validateUserPassword(payload.user, payload.password)
    if (isValid !== true) {
      throw new HttpError(401, 'Invalid credentials')
    }

    if (useSessions) {
      evictOldestUserSessionsIfNeeded(payload.user)
    }

    const refreshToken = await createToken(payload.user, 'refresh')
    const accessToken = await createToken(payload.user, 'access')
    const now = Date.now()
    const meta = sessionMetadataFn
      ? await sessionMetadataFn(payload, request)
      : undefined

    if (useSessions) {
      const rid = tokenKeyId(refreshToken)
      cache.setex(
        `refresh:${rid}`,
        { user: payload.user, createdAt: now, ...(meta && { metadata: meta }) },
        refreshTokenExpiry
      )
      if (useSessions !== 'refresh-only') {
        const aid = tokenKeyId(accessToken)
        cache.setex(`access:${aid}`, { user: payload.user, createdAt: now }, accessTokenExpiry)
      }
    }

    response.writeHead(200, {
      'Set-Cookie': `refresh-token=${refreshToken}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      'content-type': 'application/json'
    })
    response.end(JSON.stringify({ accessToken }))
    return next()
  }

  const logout = async (payload, request, response) => {
    const wantAll = payload && typeof payload === 'object' && payload.logoutAll === true

    const clearSessionKeysForUser = (user) => {
      if (!cache || !user) return
      const all = cache.get('*')
      if (!all || typeof all !== 'object') return
      for (const k of Object.keys(all)) {
        if ((k.startsWith('refresh:') || k.startsWith('access:')) && all[k]?.user === user) {
          cache.del(k)
        }
      }
    }

    let user = null

    const authToken = request.headers?.[HEADERS.AUTH_TOKEN]
    if (authToken) {
      try {
        const decoded = decodeBase64(authToken)
        const [tokenPayload] = decoded.split('.')
        const parsed = JSON.parse(tokenPayload)
        if (parsed?.user) user = parsed.user
      } catch (_) { /* ignore */ }
    }

    if (!user && request.headers?.cookie) {
      try {
        const match = request.headers.cookie.match(/refresh-token=([^;]+)/)
        const refreshTokenEncoded = match?.[1]
        if (refreshTokenEncoded) {
          const decoded = decodeBase64(refreshTokenEncoded)
          const [tokenPayload] = decoded.split('.')
          const parsed = JSON.parse(tokenPayload)
          if (parsed?.user) user = parsed.user
        }
      } catch (_) { /* ignore */ }
    }

    if (useSessions && user) {
      if (wantAll) {
        clearSessionKeysForUser(user)
      } else {
        const match = request.headers?.cookie?.match(/refresh-token=([^;]+)/)
        const refreshEnc = match?.[1]
        if (refreshEnc) {
          const rid = tokenKeyId(refreshEnc)
          cache.del(`refresh:${rid}`)
        }
        if (useSessions !== 'refresh-only' && authToken) {
          const aid = tokenKeyId(authToken)
          cache.del(`access:${aid}`)
        }
      }
    }

    const clearCookie = 'refresh-token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
    response.writeHead(200, {
      'Set-Cookie': clearCookie,
      'content-type': 'application/json'
    })
    response.end(JSON.stringify({ success: true }))
    return next()
  }

  const getNewAccessToken = async (payload, request) => {
    logger.info(`checking cookie for refresh token ${request.headers.cookie}`)

    if (!request.headers.cookie) {
      throw new HttpError(400, 'Invalid auth request')
    }

    const m = request.headers.cookie.match(/refresh-token=([^;]+)/)
    const refreshTokenEncoded = m?.[1]
    if (!refreshTokenEncoded) {
      throw new HttpError(400, 'Invalid auth request')
    }

    const refreshToken = decodeBase64(refreshTokenEncoded)
    const [tokenPayload, signature] = refreshToken.split('.')

    payload = JSON.parse(tokenPayload)
    const isValid = await ed25519.verify(keyPair, tokenPayload, signature)
    if (!isValid) {
      throw new HttpError(400, 'Invalid auth request')
    }
    if (payload.expire < Date.now()) {
      throw new HttpError(401, 'Expired refresh token')
    }
    assertPayloadKidMatches(payload)

    if (useSessions) {
      const rid = tokenKeyId(refreshTokenEncoded)
      const entry = cache.get(`refresh:${rid}`)
      if (!entry || entry.user !== payload.user) {
        throw new HttpError(401, 'Invalid session')
      }
    }

    const accessToken = await createToken(payload.user, 'access')
    if (useSessions && useSessions !== 'refresh-only') {
      const aid = tokenKeyId(accessToken)
      cache.setex(`access:${aid}`, { user: payload.user, createdAt: Date.now() }, accessTokenExpiry)
    }

    return { accessToken }
  }

  const verifyAccessToken = async (accessToken) => {
    let decodedToken
    let tokenPayload
    let signature
    try {
      decodedToken = decodeBase64(accessToken)
      const parts = decodedToken.split('.')
      signature = parts.pop()
      tokenPayload = parts.join('.')
    } catch (err) {
      throw new HttpError(401, 'Invalid access token')
    }

    let payload
    try {
      payload = JSON.parse(tokenPayload)
    } catch (err) {
      throw new HttpError(401, 'Invalid access token')
    }

    const isValid = await ed25519.verify(keyPair, tokenPayload, signature)
    if (!isValid) {
      throw new HttpError(401, 'Invalid access token')
    }
    if (payload.expire < Date.now()) {
      throw new HttpError(401, 'Expired access token')
    }
    assertPayloadKidMatches(payload)

    if (useSessions && useSessions !== 'refresh-only') {
      const aid = tokenKeyId(accessToken)
      const entry = cache.get(`access:${aid}`)
      if (!entry || entry.user !== payload.user) {
        throw new HttpError(401, 'Invalid session')
      }
    }
    return { isValid, status: 'valid access token', user: payload.user, payload }
  }

  const server = await createService(serviceName, async function authService(payload, request, response) {
    if (payload.authenticate) return authenticate(payload.authenticate, request, response)
    if (payload.logout) return logout(payload.logout, request, response)
    if (payload.verifyAccess) return verifyAccessToken(payload.verifyAccess, request, response)
    return getNewAccessToken(payload, request)
  })

  if (cache && typeof cache.terminate === 'function') {
    const inner = server.terminate.bind(server)
    server.terminate = async () => {
      try {
        await cache.terminate()
      } catch (err) {
        logger.debug('auth cache terminate failed:', err?.message)
      }
      await inner()
    }
  }

  return server
}
