/**
 * Load or create an Ed25519 keypair (Web Crypto) for auth signing.
 * Persists as JWK JSON under keyDir; supports env and ephemeral runtimes.
 */
import { createHash, randomBytes } from 'node:crypto'
import crypto from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync
} from 'node:fs'
import { join } from 'node:path'
import envConfig from '../shared/env-config.js'

function kidFromPublicJwk(publicJwk) {
  return createHash('sha256').update(JSON.stringify(publicJwk), 'utf8').digest('hex').slice(0, 16)
}

async function exportJwkKeyPair(keyPair) {
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  return { publicJwk, privateJwk }
}

async function importJwkToKeyPair({ publicJwk, privateJwk }) {
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'Ed25519' }, true, ['verify'])
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'Ed25519' }, true, ['sign'])
  return { publicKey, privateKey }
}

function parseJwkKeypairFromEnv() {
  const raw = process.env.YAMF_AUTH_KEYPAIR
  if (!raw) return null
  let json
  try {
    const buf = Buffer.from(raw.trim(), 'base64')
    json = JSON.parse(buf.toString('utf8'))
  } catch {
    try {
      json = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!json?.publicJwk || !json?.privateJwk) return null
  return json
}

function defaultKeyDir() {
  const home = envConfig.get('YAMF_HOME', join(process.cwd(), '.yamf'))
  return join(home, 'auth')
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.keyName='default']
 * @param {string} [opts.keyDir] - default YAMF_HOME/auth
 * @param {boolean} [opts.ephemeral=false] - generate in memory only, no file
 * @returns {Promise<{ keyPair: CryptoKeyPair, kid: string }>}
 */
export async function loadOrCreateEd25519KeyPair({
  keyName = 'default',
  keyDir = defaultKeyDir(),
  ephemeral = false
} = {}) {
  if (!ephemeral) {
    const fromEnv = parseJwkKeypairFromEnv()
    if (fromEnv) {
      const keyPair = await importJwkToKeyPair(fromEnv)
      const kid = fromEnv.kid || kidFromPublicJwk(fromEnv.publicJwk)
      return { keyPair, kid }
    }
  }

  if (!ephemeral) {
    mkdirSync(keyDir, { recursive: true })
    const filePath = join(keyDir, `${keyName}.json`)
    if (existsSync(filePath)) {
      try {
        const stored = JSON.parse(readFileSync(filePath, 'utf8'))
        const { publicJwk, privateJwk, kid: storedKid } = stored
        if (publicJwk && privateJwk) {
          const keyPair = await importJwkToKeyPair({ publicJwk, privateJwk })
          const kid = storedKid || kidFromPublicJwk(publicJwk)
          return { keyPair, kid }
        }
      } catch {
        /* fall through to regenerate */
      }
    }
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign', 'verify']
  )
  const { publicJwk, privateJwk } = await exportJwkKeyPair(keyPair)
  const kid = kidFromPublicJwk(publicJwk)

  if (ephemeral) {
    return { keyPair, kid }
  }

  const filePath = join(keyDir, `${keyName}.json`)
  const payload = JSON.stringify(
    { version: 1, publicJwk, privateJwk, kid, createdAt: new Date().toISOString() },
    null,
    2
  )
  const tmp = filePath + '.tmp.' + randomBytes(8).toString('hex')
  writeFileSync(tmp, payload, { mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch { /* best effort */ }
  renameSync(tmp, filePath)
  try {
    chmodSync(filePath, 0o600)
  } catch { /* best effort */ }

  return { keyPair, kid }
}

export { kidFromPublicJwk }
