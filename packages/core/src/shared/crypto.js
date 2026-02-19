
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


const argon2 = promisify(crypto.argon2)
const argon2Parameters = {
  parallelism: 4,
  tagLength: 64,
  memory: 65536,
  passes: 3
}

export async function createArgonSaltAndHash(password) {

  const saltBytes = randomBytes(16)

  let derivedKey = await argon2('argon2id', {
    ...argon2Parameters,
    message: password,
    nonce: saltBytes,
  })

  const hash = derivedKey.toString('base64')
  const salt = saltBytes.toString('base64')
  // console.warn('createArgonSaltAndHash', { salt, hash })

  return { salt, hash }
}

export async function checkArgonPassword(passToCheck, salt, hash) {

  // console.warn('checkArgonPassword', { salt, hash })
  let saltBytes = Buffer.from(salt, 'base64')
  let derivedKey = await argon2('argon2id', {
    ...argon2Parameters,
    message: passToCheck,
    nonce: saltBytes,
  })

  const hashToCheck = derivedKey.toString('base64')
  return hashToCheck === hash
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

export function decryptAES256GCM(encryptedData, ivHex, authTagHex) {
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)

  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

// TODO quantum-ready encryption (PQC) - https://csrc.nist.gov/pubs/fips/205/final
