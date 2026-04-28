/**
 * Safe filenames and path containment for uploads and static file serving (slice B)
 */
import path from 'node:path'

// Unicode bidi overrides (common spoofing) — U+202A..U+202E, U+2066..U+2069
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g
const CTRL_OR_NULL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

/** Use for URL / path-segment safety (file-server) — keep in sync with filename sanitizer. */
export const URL_PATH_DANGEROUS_CTRL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/

/**
 * Normalize and sanitize a single path segment or filename for untrusted input.
 * @param {string} name
 * @param {{ maxBytes?: number }} [opts] — max UTF-8 length (default 160)
 * @returns {string}
 */
export function sanitizePathSegment(name, opts = {}) {
  const maxBytes = opts.maxBytes != null ? opts.maxBytes : 160
  if (name == null || name === '') return 'unnamed'
  let s = String(name)
  s = s.replace(BIDI_OVERRIDES, '')
  s = s.replace(CTRL_OR_NULL, '')
  s = s.replace(/\\/g, '')
  s = s.replace(/\//g, '')
  s = s.normalize('NFC')
  s = s.replace(/^\.+/, '')
  s = s.replace(/\.{2,}/g, '.')
  const enc = new TextEncoder()
  if (enc.encode(s).length > maxBytes) {
    s = new TextDecoder().decode(enc.encode(s).slice(0, maxBytes))
  }
  return s || 'unnamed'
}

/**
 * @param {string} resolvedPath — result of path.resolve
 * @param {string} rootDir — allowed root
 * @returns {boolean}
 */
export function isPathUnderRoot(resolvedPath, rootDir) {
  const root = path.resolve(rootDir)
  const abs = path.resolve(resolvedPath)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  return abs === root || abs.startsWith(prefix)
}
