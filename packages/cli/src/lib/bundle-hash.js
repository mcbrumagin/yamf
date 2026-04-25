import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * @param {string} absolutePath
 * @returns {string} hex without prefix
 */
function sha256File (absolutePath) {
  const buf = readFileSync(absolutePath)
  return createHash('sha256').update(buf).digest('hex')
}

/** Lockfiles in project root; included in `deps` when `packages: 'external'` so hash tracks dependency-only changes. */
const LOCKFILE_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb']

/**
 * @param {string} absRoot
 * @returns {Record<string, string>}
 */
export function hashLockfilesAtProjectRoot (absRoot) {
  const out = {}
  for (const n of LOCKFILE_NAMES) {
    const p = join(absRoot, n)
    if (existsSync(p)) {
      out[n] = `sha256-${sha256File(p)}`
    }
  }
  return out
}

/**
 * @param {Record<string, { bytesInOutput?: number }>} inputs - esbuild metafile.inputs
 * @param {string} absWorkingDir
 * @returns {Record<string, string>} relativePath → `sha256-<hex>` content hash
 */
export function hashInputsFromMetafile (inputs, absWorkingDir) {
  const deps = {}
  if (!inputs) return deps
  const absRoot = absWorkingDir.replace(/\\/g, '/')
  for (const p of Object.keys(inputs).sort()) {
    const norm = p.replace(/\\/g, '/')
    const rel = norm.startsWith(absRoot) ? relative(absWorkingDir, p).split('\\').join('/') : norm
    const hex = sha256File(p)
    deps[rel] = `sha256-${hex}`
  }
  return deps
}

/**
 * @param {Uint8Array|Buffer} bundleBytes
 * @param {object} meta
 * @param {string} meta.entry
 * @param {string[]=} meta.env
 * @param {Record<string, string>=} meta.deps
 * @param {string=} meta.nodeTarget
 * @param {string=} meta.builderVersion
 */
export function computeBundleHash (bundleBytes, meta) {
  const buf = Buffer.isBuffer(bundleBytes) ? bundleBytes : Buffer.from(bundleBytes)
  const normalized = {
    entry: meta.entry,
    env: [...(meta.env || [])].sort(),
    deps: Object.fromEntries(Object.entries(meta.deps || {}).sort()),
    nodeTarget: meta.nodeTarget,
    builderVersion: meta.builderVersion
  }
  const h = createHash('sha256')
  h.update(buf)
  h.update('\0')
  h.update(JSON.stringify(normalized))
  return `sha256-${h.digest('hex')}`
}
