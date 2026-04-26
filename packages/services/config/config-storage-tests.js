/**
 * config-service store: salt, legacy migration, delete, round-trip
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertErr } from '@yamf/test'
import { envConfig, deriveKeyScrypt32, sealJsonAesGcm256 } from '@yamf/core'
import { createConfigStore } from './storage.js'

const LEGACY_SALT = 'yamf-config-v1'
const TEST_PASS = 'yamf-test-config-scrypt-passphrase-32+'

function withConfigKey (fn) {
  const prev = envConfig.get('YAMF_CONFIG_KEY')
  envConfig.set('YAMF_CONFIG_KEY', TEST_PASS)
  try {
    return fn()
  } finally {
    if (prev !== undefined) {
      envConfig.set('YAMF_CONFIG_KEY', prev)
    }
  }
}

function dataDir (name) {
  return mkdtempSync(join(tmpdir(), `yamf-config-test-${name}-`))
}

/**
 * New directory: random salt, empty store, no store.enc until first write
 */
export async function testConfigStoreNewCreatesSaltFile () {
  withConfigKey(() => {
    const dir = dataDir('new')
    try {
      const s = createConfigStore(dir)
      const saltPath = join(dir, 'salt')
      const a = s.get('s', 'e')
      if (a.version !== 0 || Object.keys(a.values).length !== 0) {
        throw new Error('expected empty pack')
      }
      const line = readFileSync(saltPath, 'utf8').trim()
      if (Buffer.from(line, 'base64').length !== 16) {
        throw new Error('salt file must be 16 bytes in base64')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

/**
 * Legacy: store.enc with old fixed salt, no salt file — migrates, preserves data
 */
export async function testConfigStoreLegacyMigration () {
  withConfigKey(() => {
    const dir = dataDir('legacy')
    try {
      const kLegacy = deriveKeyScrypt32(TEST_PASS, LEGACY_SALT, { N: 16384, r: 8, p: 1 })
      const all = { 'myapp\0prod': { version: 0, values: { API_KEY: 'secret1' } } }
      const enc = sealJsonAesGcm256(kLegacy, all)
      writeFileSync(join(dir, 'store.enc'), enc, { mode: 0o600, encoding: 'utf8' })

      const s = createConfigStore(dir)
      if (!readFileSync(join(dir, 'salt'), 'utf8').trim()) {
        throw new Error('migration should write salt')
      }
      const p = s.get('myapp', 'prod')
      if (p.values.API_KEY !== 'secret1' || p.version < 0) {
        throw new Error('migrated data mismatch')
      }

      const s2 = createConfigStore(dir)
      const p2 = s2.get('myapp', 'prod')
      if (p2.values.API_KEY !== 'secret1') {
        throw new Error('second open should read migrated store')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

export async function testConfigStoreSetAndRemove () {
  withConfigKey(() => {
    const dir = dataDir('del')
    try {
      const s = createConfigStore(dir)
      s.set('s', 'e', { A: '1' })
      s.set('s', 'e', { B: '2' })
      const p = s.get('s', 'e')
      if (p.values.A !== '1' || p.values.B !== '2') {
        throw new Error('set failed')
      }
      s.removeKeys('s', 'e', ['A'])
      const p2 = s.get('s', 'e')
      if (p2.values.A !== undefined || p2.values.B !== '2') {
        throw new Error('removeKeys failed')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

export async function testConfigStoreVersionConflictOnRemove () {
  withConfigKey(() => {
    const dir = dataDir('ver')
    try {
      const s = createConfigStore(dir)
      s.set('s', 'e', { K: 'v' }, null)
      const v = s.get('s', 'e').version
      assertErr.sync(
        () => s.removeKeys('s', 'e', ['K'], v - 1),
        (err) => err.code === 'VERSION_CONFLICT'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

export async function testConfigStoreRequiresKey () {
  const prev = envConfig.get('YAMF_CONFIG_KEY')
  envConfig.set('YAMF_CONFIG_KEY', null)
  const dir = dataDir('nokey')
  try {
    await assertErr(
      () => {
        createConfigStore(dir)
      },
      (err) =>
        err.message.includes('YAMF_CONFIG_KEY') &&
        err.message.includes('openssl rand -base64 32')
    )
  } finally {
    if (prev !== undefined) {
      envConfig.set('YAMF_CONFIG_KEY', prev)
    }
    rmSync(dir, { recursive: true, force: true })
  }
}
