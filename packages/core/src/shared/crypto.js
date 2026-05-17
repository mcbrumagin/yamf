
// import { hash, verify } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import crypto from 'crypto'
import { promisify } from 'util'

// --- simple fast checking for uniqueness ------------------------------------

export function calculateMD5Checksum(data) {
  return crypto.createHash('md5').update(data).digest('hex')
}

export function calculateSHA1Checksum(data) {
  return crypto.createHash('sha1').update(data).digest('hex')
}


// --- safe from collision attacks --------------------------------------------

export function calculateSHA256Checksum(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

export function calculateSHA512Checksum(data) {
  return crypto.createHash('sha512').update(data).digest('hex')
}


// --- Ed25519 key pair generation, signing, and verification ----------------

export const ed25519 = {

  generateKeyPair: async function() {
    return await crypto.subtle.generateKey(
      {
        name: 'Ed25519',
        namedCurve: 'Ed25519'
      },
      true, // extractable
      ['sign', 'verify']
    )
  },

  sign: async function(keyPair, data) {
    return Buffer.from(await crypto.subtle.sign(
      {
        name: 'Ed25519'
      },
      keyPair.privateKey,
      Buffer.from(data, 'utf8')
    )).toString('base64')
  },

  verify: async function(keyPair, data, signature) {
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      keyPair.publicKey,
      Buffer.from(signature, 'base64'),
      Buffer.from(data, 'utf8')
    )
  }
}


// --- password hash and salt generation -------------------------------------
// Using base64 encoding for more compact storage (33% smaller than hex)
// 16 byte salt = 24 base64 chars (vs 32 hex chars)
// 64 byte hash = 88 base64 chars (vs 128 hex chars)


const argon2Parameters = {
  parallelism: 4,
  tagLength: 64,
  memory: 65536,
  passes: 3
}

/** `crypto.argon2` exists in Node.js 24+; when absent we use built-in scrypt (Node 22+). */
let argon2AsyncCached
function getArgon2Async() {
  if (typeof crypto.argon2 !== 'function') return null
  if (!argon2AsyncCached) argon2AsyncCached = promisify(crypto.argon2)
  return argon2AsyncCached
}

const scryptAsync = promisify(crypto.scrypt)
const SCRYPT_KEYLEN = 64
/** Prefix on `hash` when stored credentials use scrypt (no native `crypto.argon2`). */
const SCRYPT_HASH_PREFIX = 'scrypt1:'
const scryptParameters = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
}

async function createScryptSaltAndHash(password) {
  const saltBytes = randomBytes(16)
  const salt = saltBytes.toString('base64')
  const derivedKey = await scryptAsync(password, saltBytes, SCRYPT_KEYLEN, scryptParameters)
  return { salt, hash: `${SCRYPT_HASH_PREFIX}${derivedKey.toString('base64')}` }
}

async function checkScryptPassword(passToCheck, salt, hashWithPrefix) {
  const payload = hashWithPrefix.slice(SCRYPT_HASH_PREFIX.length)
  const saltBytes = Buffer.from(salt, 'base64')
  const expected = Buffer.from(payload, 'base64')
  const derivedKey = await scryptAsync(passToCheck, saltBytes, SCRYPT_KEYLEN, scryptParameters)
  if (expected.length !== derivedKey.length) return false
  return crypto.timingSafeEqual(expected, derivedKey)
}

export async function createArgonSaltAndHash(password) {
  const argon2 = getArgon2Async()
  if (argon2) {
    const saltBytes = randomBytes(16)
    const salt = saltBytes.toString('base64')
    const derivedKey = await argon2('argon2id', {
      ...argon2Parameters,
      message: password,
      nonce: saltBytes,
    })
    return { salt, hash: derivedKey.toString('base64') }
  }
  return createScryptSaltAndHash(password)
}

export async function checkArgonPassword(passToCheck, salt, hash) {
  const saltBytes = Buffer.from(salt, 'base64')
  if (hash.startsWith(SCRYPT_HASH_PREFIX)) {
    return checkScryptPassword(passToCheck, salt, hash)
  }
  const argon2 = getArgon2Async()
  if (!argon2) {
    throw new Error(
      'Password hash uses Argon2 (Node.js 24+ native crypto.argon2). Use Node 24+ or reset credentials so they can be re-hashed.'
    )
  }
  const derivedKey = await argon2('argon2id', {
    ...argon2Parameters,
    message: passToCheck,
    nonce: saltBytes,
  })
  const expected = Buffer.from(hash, 'base64')
  if (expected.length !== derivedKey.length) return false
  return crypto.timingSafeEqual(expected, derivedKey)
}

// export createArgon2Hash
// const password = "mySecretPassword";
// const hashed = await hash('argon2id', password, {
//     timeCost: 3, // iterations
//     memoryCost: 1 << 16, // 64 MB
//     parallelism: 1, // threads
// });

// // Verifying a password (Vanilla)
// const isMatch = await verify('argon2id', password, hashed);

const pbkdf2 = promisify(crypto.pbkdf2)
const HASH_ITERATIONS = 100
const SALT_LENGTH = 16
const KEY_LENGTH = 32
const HASH_DIGEST = 'sha256'
export async function createSaltedHash(password) {
  const saltBytes = crypto.randomBytes(SALT_LENGTH)
  const salt = saltBytes.toString('base64')
  const derivedKey = await pbkdf2(password, saltBytes, HASH_ITERATIONS, KEY_LENGTH, HASH_DIGEST)
  const hash = derivedKey.toString('base64')
  return { salt, hash }
}

// use to check a new login attempt against db salt and hash
export async function checkPasswordForSaltAndHash(passToCheck, salt, hash) {
  const saltBytes = Buffer.from(salt, 'base64')
  const derivedKey = await pbkdf2(passToCheck, saltBytes, HASH_ITERATIONS, KEY_LENGTH, HASH_DIGEST)
  const hashToCheck = derivedKey.toString('base64')
  return hashToCheck === hash
}

// --- AES-256-GCM encryption/decryption -------------------------------------
// quantum-resistant, but not guarenteed

export function encryptAES256GCM(plaintext, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  }
}

export function decryptAES256GCM(encryptedData, ivHex, authTagHex, key) {
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)

  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * Derive a 32-byte AES-256 key from a passphrase (e.g. `YAMF_CONFIG_KEY`) using scrypt.
 * @param {string|Buffer} passphrase
 * @param {string|Buffer} salt
 * @param {object} [options] scrypt options (e.g. N, r, p)
 * @returns {Buffer}
 */
export function deriveKeyScrypt32 (passphrase, salt, options = { N: 16384, r: 8, p: 1 }) {
  return crypto.scryptSync(passphrase, salt, 32, options)
}

/**
 * AEAD-encrypt JSON to a single UTF-8 string (uses existing AES-256-GCM helpers).
 * For at-rest secrets (e.g. config store). Do not invent ciphers; use this + Node `crypto` only.
 * @param {Buffer} key - 32 bytes
 * @param {object} obj
 * @returns {string}
 */
export function sealJsonAesGcm256 (key, obj) {
  const { encryptedData, iv, authTag } = encryptAES256GCM(JSON.stringify(obj), key)
  return JSON.stringify({
    v: 1,
    alg: 'aes-256-gcm',
    iv,
    tag: authTag,
    d: encryptedData
  })
}

/**
 * @param {Buffer} key - 32 bytes
 * @param {string} sealedJson
 * @returns {object}
 */
export function openJsonAesGcm256 (key, sealedJson) {
  const p = JSON.parse(sealedJson)
  if (p.v !== 1 || p.alg !== 'aes-256-gcm' || !p.iv || !p.tag || p.d == null) {
    throw new Error('Invalid sealed payload (expected v1 aes-256-gcm)')
  }
  const text = decryptAES256GCM(p.d, p.iv, p.tag, key)
  return JSON.parse(text)
}

// TODO quantum-ready encryption (PQC) - https://csrc.nist.gov/pubs/fips/205/final
