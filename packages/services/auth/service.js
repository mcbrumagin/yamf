import {
  createService,
  Logger,
  HttpError,
  next,
  envConfig,
  HEADERS
} from '@yamf/core'

import { createInMemoryCache } from '@yamf/services-cache'
import { ed25519 } from '@yamf/core/crypto'

const logger = new Logger({ logGroup: 'yamf-services' })


/*

  hybrid JWT-lite w/ optional sessions 
  - opinionated ed25519 assymetric signing/verification, so no need for JWT header
  - expiration data is stored in refresh/access tokens that are part of the signature
  - expirations can also be saved in memory, if revocation is needed
  - on login, a refresh token will be returned to the client, along with an access token
  - the auth service will handle signing/authentication with the private key
  - the refresh token will be used by a client on landing to generate a new access token
  - [unimplemnted]access tokens can be verified by services that have the public key

  TODO: public key will be sent on a pubsub channel so other services can subscribe to it
  TODO: brute force protection for authentication endpoints (rate limiting, IP-based restrictions, CAPTCHAs)
*/

// default to hardcoded single admin user
const defaultValidateUser = async (username, password) => {
  let user = envConfig.getRequired('ADMIN_USER')
  let pass = envConfig.getRequired('ADMIN_PASS')
  if (user !== username || pass !== password) return false
  else return true
}

// eventually will be backed by a database
export default async function createAuthService({
  serviceName = 'auth-service',
  useSessions = 'refresh-only',
  validateUserPassword = defaultValidateUser,
  enrichTokenPayload = null
} = {}) {
  if (useSessions && useSessions !== true && useSessions !== 'refresh-only') {
    throw new Error('useSessions must be true or "refresh-only"')
  }

  const keyPair = await ed25519.generateKeyPair()

  // should use an internal memory-only cache for security
  const defaultAccessTokenExpireTime = 60000 * 30
  const defaultRefreshTokenExpireTime = 60000 * 60 * 24


  const createToken = async (user, type = 'access') => {
    let expire = Date.now() + (type === 'access' ? defaultAccessTokenExpireTime : defaultRefreshTokenExpireTime)
    const extra = enrichTokenPayload ? await enrichTokenPayload(user) : {}
    const payload = JSON.stringify({ user, expire, ...extra })
    const signature = await ed25519.sign(keyPair, payload)
    logger.debug(`signature: ${signature}`)
    return encodeBase64(`${payload}.${signature}`)
  }

  const encodeBase64 = (data) => {
    return Buffer.from(data).toString('base64')
  }

  const decodeBase64 = (data) => {
    return Buffer.from(data, 'base64').toString('utf8')
  }

  const cache = !useSessions ? null :createInMemoryCache({
    expireTime: defaultAccessTokenExpireTime,
    evictionInterval: defaultAccessTokenExpireTime / 30
  })

  const authenticate = async (payload, request, response) => {
    logger.debug(`authenticating user ${payload.user}`)

    let isValid = await validateUserPassword(payload.user, payload.password)
    
    if (!isValid) {
      throw new HttpError(401, 'Invalid credentials')
    }

    const refreshToken = await createToken(payload.user, 'refresh')
    const accessToken = await createToken(payload.user, 'access')
    
    if (useSessions) {
      cache.setex(`${payload.user}:refresh-token`, refreshToken, defaultRefreshTokenExpireTime)
      if (useSessions !== 'refresh-only') {
        cache.setex(`${payload.user}:access-token`, accessToken)
      }
    }

    // TODO different security settings for production/development
    response.writeHead(200, {
      'Set-Cookie': `refresh-token=${refreshToken}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      'content-type': 'application/json'
    })
    response.end(JSON.stringify({ accessToken }))
    return next()
  }

  /**
   * Logout: invalidate sessions when enabled, then clear the refresh-token cookie.
   * If sessions are disabled, does nothing except clear the cookie so the client drops it.
   */
  const logout = async (payload, request, response) => {
    let user = null

    const authToken = request.headers?.[HEADERS.AUTH_TOKEN]
    if (authToken) {
      try {
        const decoded = decodeBase64(authToken)
        const [tokenPayload] = decoded.split('.')
        const parsed = JSON.parse(tokenPayload)
        if (parsed?.user) user = parsed.user
      } catch (_) { /* ignore invalid token */ }
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
      cache.del(`${user}:refresh-token`)
      if (useSessions !== 'refresh-only') {
        cache.del(`${user}:access-token`)
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

    // TODO error if payload is not null? we are using the refresh token header
    if (!request.headers.cookie) {
      throw new HttpError(400, 'Invalid auth request')
    }

    let refreshTokenEncoded = request.headers.cookie.split('refresh-token=')[1]
    logger.info(`refresh token header: ${refreshTokenEncoded}`)
    let refreshToken = decodeBase64(refreshTokenEncoded)
    logger.info(`refresh token decoded: ${refreshToken}`)
    const [tokenPayload, signature] = refreshToken.split('.')

    payload = JSON.parse(tokenPayload)

    let isValid = await ed25519.verify(keyPair, tokenPayload, signature)

    if (!isValid) {
      throw new HttpError(400, 'Invalid auth request')
    } else if (payload.expire < Date.now()) {
      throw new HttpError(401, 'Expired refresh token')
    }

    if (useSessions) {
      let cacheToken = cache.get(`${payload.user}:refresh-token`)
      if (!cacheToken || cacheToken !== refreshTokenEncoded) {
        throw new HttpError(401, 'Invalid session')
      }
    }

    const accessToken = await createToken(payload.user, 'access')
    if (useSessions && useSessions !== 'refresh-only') {
      cache.setex(`${payload.user}:access-token`, accessToken)
    }

    return { accessToken }
  }

  const verifyAccessToken = async (accessToken) => {
    let decodedToken, tokenPayload, signature
    try {
      decodedToken = decodeBase64(accessToken)
      const parts = decodedToken.split('.')
      signature = parts.pop() // only the last part is the signature
      tokenPayload = parts.join('.') // reassemble the payload without the signature
    } catch (err) {
      throw new HttpError(401, 'Invalid access token')
    }

    let payload
    try {
      payload = JSON.parse(tokenPayload)
    } catch (err) {
      throw new HttpError(401, 'Invalid access token')
    }

    let isValid = await ed25519.verify(keyPair, tokenPayload, signature)
    if (!isValid) {
      throw new HttpError(401, 'Invalid access token')
    } else if (payload.expire < Date.now()) {
      throw new HttpError(401, 'Expired access token')
    }

    if (useSessions && useSessions !== 'refresh-only') {
      let cacheToken = cache.get(`${payload.user}:access-token`)
      if (!cacheToken || cacheToken !== accessToken) {
        throw new HttpError(401, 'Invalid session')
      }
    }
    return { isValid, status: 'valid access token', user: payload.user, payload }
  }

  const server = await createService(serviceName, async function authService(payload, request, response) {
    // TODO bearer token?
    if (payload.authenticate) return authenticate(payload.authenticate, request, response)
    else if (payload.logout) return logout(payload.logout, request, response)
    else if (payload.verifyAccess) return verifyAccessToken(payload.verifyAccess, request, response)
    else return getNewAccessToken(payload, request, response)
  })

  // TODO if we add CSRF protection, we need to add process tokens for form state
  // NOTE it should not be needed since we are using JWT lite, but it would be good for defense in depth
  // will be ideal for financial/medical data, legacy browsers, or samesite relaxation

  return server
}
