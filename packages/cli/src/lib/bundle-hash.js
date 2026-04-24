import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

/**
 * @param {string} absolutePath
 * @returns {string} hex without prefix
 */
function sha256File (absolutePath) {
  const buf = readFileSync(absolutePath)
  return createHash('sha256').update(buf).digest('hex')
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
