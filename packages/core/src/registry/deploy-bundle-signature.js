/**
 * C6 (ROADMAP Tier 2): optional Ed25519 signatures on deploy bundles.
 * Registry keeps allow-listed public keys; clients sign the content-address string (e.g. sha256-…)
 * with a PEM PKCS8 private key (YAMF_DEPLOY_PRIVATE_KEY).
 *
 * @module @yamf/core/registry/deploy-bundle-signature
 */

import { readFileSync, existsSync } from 'node:fs'
import { createPublicKey, createPrivateKey, sign, verify } from 'node:crypto'
import { join } from 'node:path'
import envConfig from '../shared/env-config.js'
import { HEADERS } from '../shared/yamf-headers.js'

/** DER prefix for 32-byte Ed25519 subjectPublicKey in SPKI form (raw public key is last 32 bytes). */
const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
])

/**
 * @param {Buffer} raw32
 * @returns {import('node:crypto').KeyObject}
 */
function rawEd25519PublicToKey (raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.length !== 32) {
    throw new TypeError('Ed25519 raw public key must be 32 bytes')
  }
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw32]), format: 'der', type: 'spki' })
}

/**
 * @returns {import('node:crypto').KeyObject[]} - empty if not configured
 */
export function loadDeployAuthorizedPublicKeyObjectsFromDisk () {
  const custom = envConfig.get('YAMF_DEPLOY_AUTHORIZED_KEYS', null)
  const yamfHome = String(envConfig.get('YAMF_HOME', join(process.cwd(), '.yamf')) || join(process.cwd(), '.yamf'))
  const p =
    (custom != null && String(custom).trim() !== '' && String(custom).trim()) ||
    join(yamfHome, 'deploy', 'authorized_keys')
  if (!existsSync(p)) {
    return []
  }
  const text = readFileSync(p, 'utf8')
  const keys = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const raw = Buffer.from(t, 'base64')
    if (raw.length !== 32) {
      continue
    }
    try {
      keys.push(rawEd25519PublicToKey(raw))
    } catch { /* */ }
  }
  return keys
}

/**
 * @param {string} hashUtf8
 * @param {string} signatureBase64
 * @param {import('node:crypto').KeyObject[]} publicKeyObjects
 * @returns {boolean}
 */
export function verifyEd25519SignatureOnDeployHash (hashUtf8, signatureBase64, publicKeyObjects) {
  if (!publicKeyObjects?.length) {
    return false
  }
  const sig = Buffer.from(String(signatureBase64 || '').trim(), 'base64')
  if (sig.length !== 64) {
    return false
  }
  const msg = Buffer.from(String(hashUtf8), 'utf8')
  for (const pub of publicKeyObjects) {
    try {
      if (verify(null, msg, pub, sig)) {
        return true
      }
    } catch { /* */ }
  }
  return false
}

/**
 * If `authorized_keys` is non-empty, require a valid `yamf-bundle-ed25519-sig` for this hash.
 * @param {{ hash: string, headers: Record<string, string|undefined> }} p
 * @returns {{ ok: true } | { status: number, message: string }}
 */
export function enforceDeployBundleEd25519Policy (p) {
  const pubKeys = loadDeployAuthorizedPublicKeyObjectsFromDisk()
  if (pubKeys.length === 0) {
    return { ok: true }
  }
  const h = p.headers || {}
  const sig = h[HEADERS.BUNDLE_ED25519_SIG] || h['yamf-bundle-ed25519-sig']
  if (!sig || !String(sig).trim()) {
    return {
      status: 401,
      message: 'Ed25519 signature required: deploy authorized_keys is configured; send yamf-bundle-ed25519-sig (base64 over UTF-8 hash string)'
    }
  }
  if (!verifyEd25519SignatureOnDeployHash(p.hash, String(sig).trim(), pubKeys)) {
    return { status: 403, message: 'Invalid Ed25519 signature for yamf-bundle-ed25519-sig' }
  }
  return { ok: true }
}

/**
 * Sign the deploy hash (same message as the registry verifies). Use PEM PKCS8 from `YAMF_DEPLOY_PRIVATE_KEY`.
 * @param {string} hashUtf8
 * @param {string} privateKeyPemPath
 * @returns {string} base64 signature
 */
export function signDeployHashWithEd25519Pem (hashUtf8, privateKeyPemPath) {
  const pem = readFileSync(privateKeyPemPath, 'utf8')
  const privateKey = createPrivateKey(pem)
  return sign(null, Buffer.from(String(hashUtf8), 'utf8'), privateKey).toString('base64')
}