import { createDecipheriv } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { envConfig } from '@yamf/core/env-config'
import { deriveKeyScrypt32, sealJsonAesGcm256, openJsonAesGcm256 } from '@yamf/core/crypto'

const KEY_SALT = 'yamf-config-v1'

/**
 * @returns {Buffer}
 */
function getMasterKey () {
  const raw = envConfig.get('YAMF_CONFIG_KEY', null)
  if (!raw) {
    throw new Error('YAMF_CONFIG_KEY is required (passphrase; scrypt-derived to 32 bytes in @yamf/core/crypto)')
  }
  return deriveKeyScrypt32(String(raw), KEY_SALT, { N: 16384, r: 8, p: 1 })
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
  const key = getMasterKey()
  /** @type {Map<string, { version: number, values: Record<string, string> }>} */
  const mem = new Map()
  const filePath = () => join(baseDir, 'store.enc')
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
  const save = () => {
    mkdirSync(baseDir, { recursive: true })
    const all = Object.fromEntries(mem)
    const text = sealJsonAesGcm256(key, all)
    const p = filePath()
    const tmp = `${p}.${process.pid}.tmp`
    writeFileSync(tmp, text, { mode: 0o600, encoding: 'utf8' })
    renameSync(tmp, p)
  }
  load()

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
