import { createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { envConfig, deriveKeyScrypt32, sealJsonAesGcm256, openJsonAesGcm256 } from '@yamf/core'

/** @deprecated - only to decrypt pre-cross-cut-1 stores, then re-key to per-install `salt` */
const KEY_SALT_LEGACY = 'yamf-config-v1'

/**
 * @param {string|Buffer} salt
 * @returns {Buffer}
 */
function deriveKey (salt) {
  const raw = envConfig.get('YAMF_CONFIG_KEY', null)
  if (!raw) {
    throw new Error(
      'YAMF_CONFIG_KEY is required (scrypt passphrase). Generate a strong secret, e.g. `openssl rand -base64 32` — set in the environment, never commit it.'
    )
  }
  return deriveKeyScrypt32(String(raw), salt, { N: 16384, r: 8, p: 1 })
}

/**
 * @param {string} dir
 * @param {Buffer} b - 16 bytes
 */
function writeSaltAtomic (dir, b) {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'salt')
  const tmp = `${p}.tmp`
  const line = `${b.toString('base64')}\n`
  writeFileSync(tmp, line, { mode: 0o600, encoding: 'utf8' })
  renameSync(tmp, p)
}

/**
 * @param {string} dir
 * @returns {Buffer}
 */
function readSaltB64 (dir) {
  const p = join(dir, 'salt')
  const s = readFileSync(p, { encoding: 'utf8' }).trim()
  const b = Buffer.from(s, 'base64')
  if (b.length !== 16) {
    throw new Error('config store salt: expected 16 bytes (base64 in salt file), re-create salt or use a fresh YAMF_HOME config dir')
  }
  return b
}

/**
 * Legacy v0 binary: iv(12) + tag(16) + ciphertext. Same scrypt key as v1.
 * @param {Buffer} buf
 * @param {Buffer} key
 */
function openJsonLegacyBinaryBlob (buf, key) {
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const dec = createDecipheriv('aes-256-gcm', key, iv)
  dec.setAuthTag(tag)
  const out = Buffer.concat([dec.update(data), dec.final()]).toString('utf8')
  return JSON.parse(out)
}

/**
 * In-memory + encrypted file: map key `${service}\0${env}` → { version, values }
 * Crypto: @yamf/core (AES-256-GCM + scrypt) — not a separate npm crypt library.
 */
export function createConfigStore (baseDir) {
  /** @type {Buffer} */
  let key
  /** @type {Map<string, { version: number, values: Record<string, string> }>} */
  const mem = new Map()
  const filePath = () => join(baseDir, 'store.enc')
  const saltPath = () => join(baseDir, 'salt')

  const save = () => {
    mkdirSync(baseDir, { recursive: true })
    const all = Object.fromEntries(mem)
    const text = sealJsonAesGcm256(key, all)
    const p = filePath()
    const tmp = join(baseDir, `store.enc.${process.pid}.tmp`)
    try {
      writeFileSync(tmp, text, { mode: 0o600, encoding: 'utf8' })
      renameSync(tmp, p)
    } catch (e) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      throw e
    }
  }

  const load = () => {
    const p = filePath()
    if (!existsSync(p)) return
    const buf = readFileSync(p)
    const trimmed = buf.toString('utf8').trimStart()
    let all
    if (trimmed.startsWith('{')) {
      all = openJsonAesGcm256(key, buf.toString('utf8'))
    } else {
      all = openJsonLegacyBinaryBlob(buf, key)
    }
    mem.clear()
    for (const [k, v] of Object.entries(all)) {
      mem.set(k, v)
    }
  }

  mkdirSync(baseDir, { recursive: true })
  const storeExists = existsSync(filePath())
  const saltExists = existsSync(saltPath())

  if (saltExists) {
    key = deriveKey(readSaltB64(baseDir))
  } else if (storeExists) {
    key = deriveKey(KEY_SALT_LEGACY)
    load()
    const newSalt = randomBytes(16)
    writeSaltAtomic(baseDir, newSalt)
    key = deriveKey(newSalt)
    save()
  } else {
    const newSalt = randomBytes(16)
    writeSaltAtomic(baseDir, newSalt)
    key = deriveKey(newSalt)
  }

  if (!(!saltExists && storeExists)) {
    load()
  }

  return {
    get (service, env) {
      const k = `${service}\0${env}`
      return mem.get(k) || { version: 0, values: {} }
    },
    set (service, env, values, expectedVersion) {
      const k = `${service}\0${env}`
      const cur = mem.get(k) || { version: 0, values: {} }
      if (expectedVersion != null && cur.version !== expectedVersion) {
        const err = new Error(`version mismatch: have ${cur.version}, expected ${expectedVersion}`)
        err.code = 'VERSION_CONFLICT'
        throw err
      }
      const next = {
        version: cur.version + 1,
        values: { ...cur.values, ...values }
      }
      mem.set(k, next)
      save()
      return next.version
    },
    /**
     * Remove keys from one service/env row (for rotation-by-removal).
     * @param {string[]} keys
     */
    removeKeys (service, env, keys, expectedVersion) {
      const k = `${service}\0${env}`
      const cur = mem.get(k) || { version: 0, values: {} }
      if (expectedVersion != null && cur.version !== expectedVersion) {
        const err = new Error(`version mismatch: have ${cur.version}, expected ${expectedVersion}`)
        err.code = 'VERSION_CONFLICT'
        throw err
      }
      const values = { ...cur.values }
      for (const name of keys) {
        delete values[name]
      }
      const next = {
        version: cur.version + 1,
        values
      }
      mem.set(k, next)
      save()
      return next.version
    },
    list (filterService, filterEnv) {
      const out = []
      for (const [k, pack] of mem) {
        const i = k.indexOf('\0')
        if (i === -1) continue
        const s = k.slice(0, i)
        const e = k.slice(i + 1)
        if (filterService && s !== filterService) continue
        if (filterEnv && e !== filterEnv) continue
        out.push({ service: s, env: e, version: pack.version, keys: Object.keys(pack.values) })
      }
      return out
    }
  }
}
