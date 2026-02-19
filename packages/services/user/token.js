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
 * Check if a token has expired
 * 
 * @param {Date|string|null} expiresAt - Expiration timestamp
 * @returns {boolean} True if expired (or if expiresAt is null, returns false)
 */
export function isTokenExpired(expiresAt) {
  if (!expiresAt) return false // No expiry set
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  return expiry < new Date()
}
