/**
 * Registration Token Utilities
 *
 * Generates and verifies one-time registration tokens for user signup flows.
 * Tokens are URL-safe base64 encoded and stored hashed (like passwords).
 */

import { randomBytes } from 'node:crypto'
import {
  createArgonSaltAndHash,
  checkArgonPassword
} from '@yamf/core/crypto'

/**
 * Generate a secure registration token
 *
 * @param {number} length - Token length in bytes (default: 32)
 * @returns {Promise<{token: string, hash: string, salt: string}>}
 *   - token: URL-safe base64 token (shown to user once)
 *   - hash: Argon2 hash of token (stored in DB)
 *   - salt: Salt used for hashing (stored in DB)
 */
export async function generateRegistrationToken(length = 32) {
  const tokenBytes = randomBytes(length)
  // Use base64url encoding for URL/QR code safety (no +, /, or = padding issues)
  const token = tokenBytes.toString('base64url')
  const { hash, salt } = await createArgonSaltAndHash(token)
  return { token, hash, salt }
}

/**
 * Verify a registration token against stored hash and salt
 *
 * @param {string} token - The token to verify
 * @param {string} hash - The stored hash
 * @param {string} salt - The stored salt
 * @returns {Promise<boolean>} True if token is valid
 */
export async function verifyRegistrationToken(token, hash, salt) {
  if (!token || !hash || !salt) return false
  return await checkArgonPassword(token, salt, hash)
}

/**
 * Calculate token expiration date
 *
 * @param {number|null} expiresIn - Expiry time in milliseconds (null = no expiry)
 * @returns {Date|null} Expiration date or null
 */
export function calculateTokenExpiry(expiresIn) {
  if (expiresIn === null || expiresIn === undefined) return null
  return new Date(Date.now() + expiresIn)
}

/**
 * Normalize absolute expiry from DB / JSON (Date, ISO string, unix sec or ms, etc.)
 * and return epoch ms, or null if absent / invalid.
 */
function toAbsoluteExpiryMs(raw) {
  if (raw == null || raw === '') return null
  if (raw instanceof Date) {
    const ms = raw.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof raw === 'bigint') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return n < 2e10 ? Math.floor(n * 1000) : Math.floor(n)
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 2e10 ? Math.floor(raw * 1000) : Math.floor(raw)
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (/^\d+$/.test(s)) {
      const n = Number(s)
      if (!Number.isFinite(n)) return null
      return s.length >= 13 ? Math.floor(n) : Math.floor(n * 1000)
    }
    const ms = new Date(s).getTime()
    return Number.isFinite(ms) ? ms : null
  }
  try {
    const ms = new Date(raw).getTime()
    return Number.isFinite(ms) ? ms : null
  } catch {
    return null
  }
}

/**
 * Check if a token has expired
 *
 * @param {Date|string|number|null} expiresAt - Expiration timestamp
 * @returns {boolean} True if expired; false if no expiry or unparseable
 */
export function isTokenExpired(expiresAt) {
  const ms = toAbsoluteExpiryMs(expiresAt)
  if (ms == null) return false
  return ms < Date.now()
}
