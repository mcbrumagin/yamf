import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import envConfig from '../shared/env-config.js'

function defaultBundleRoot () {
  return join(envConfig.get('YAMF_HOME', join(process.cwd(), '.yamf')), 'bundles')
}

/**
 * @param {string} [baseDir] - default `${YAMF_HOME}/bundles`
 */
export function createBundleStore (baseDir) {
  const root = baseDir || defaultBundleRoot()
  mkdirSync(root, { recursive: true })
  return {
    root,
    pathFor (hash) {
      if (!hash || !/^sha256-[a-f0-9]+$/i.test(String(hash).trim())) {
        throw new Error('invalid bundle hash (expected sha256-...)')
      }
      const safe = String(hash).replace(/[^a-zA-Z0-9\-_]/g, '')
      return join(root, `${safe}.mjs`)
    }
  }
}

/**
 * @param {import('node:stream').Readable} requestStream
 * @param {string} expectedHash
 * @param {string} outPath
 */
export async function streamBundleToFileWithHashCheck (requestStream, expectedHash, outPath) {
  const h = createHash('sha256')
  const tmp = outPath + '.part'
  await pipeline(
    requestStream,
    async function* (src) {
      for await (const c of src) {
        h.update(c)
        yield c
      }
    },
    createWriteStream(tmp)
  )
  const digest = `sha256-${h.digest('hex')}`
  if (digest !== expectedHash) {
    try { rmSync(tmp) } catch { /* */ }
    const err = new Error('bundle-hash-mismatch')
    err.code = 'BUNDLE_HASH_MISMATCH'
    err.status = 422
    throw err
  }
  renameSync(tmp, outPath)
  return { stored: expectedHash, digest }
}

