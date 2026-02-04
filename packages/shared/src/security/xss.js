/**
 * XSS Prevention Module
 * 
 * Provides encoding, detection, and sanitization utilities for XSS prevention.
 * Used by both @yamf/shared validator and @yamf/client.
 * 
 * Security Philosophy:
 * - "check" mode (default): Fail validation if XSS detected - teaches developers
 * - "sanitize" mode: Transform dangerous characters to safe entities
 * - "trusted" mode: Explicit opt-out for when content is known safe
 */

// =============================================================================
// HTML Entity Encoding
// =============================================================================

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '`': '&#x60;',
}

const HTML_ENTITY_REGEX = /[&<>"'`]/g

/**
 * Encode HTML entities to prevent XSS in HTML content and attributes
 * @param {string} str - String to encode
 * @returns {string} Encoded string safe for HTML insertion
 */
export function encodeHtml(str) {
  if (typeof str !== 'string') return ''
  return str.replace(HTML_ENTITY_REGEX, char => HTML_ENTITIES[char])
}

/**
 * Encode for HTML attribute context (same as HTML encoding)
 * Attributes should always be quoted, which this encoding supports
 * @param {string} str - String to encode
 * @returns {string} Encoded string safe for attribute values
 */
export function encodeAttr(str) {
  return encodeHtml(str)
}

// =============================================================================
// XSS Detection
// =============================================================================

/**
 * Patterns that indicate potential XSS attacks
 * These are checked in "check" mode to fail validation
 */
const XSS_PATTERNS = [
  // Script tags
  /<script\b/i,
  /<\/script>/i,
  
  // Event handlers (onclick, onerror, onload, etc.)
  /\bon\w+\s*=/i,
  
  // JavaScript URLs
  /javascript\s*:/i,
  /vbscript\s*:/i,
  
  // Data URLs with executable content
  /data\s*:\s*text\/html/i,
  
  // Expression/eval patterns
  /expression\s*\(/i,
  
  // HTML injection attempts
  /<iframe\b/i,
  /<embed\b/i,
  /<object\b/i,
  /<form\b/i,
  /<input\b/i,
  /<button\b/i,
  /<textarea\b/i,
  /<select\b/i,
  /<link\b/i,
  /<style\b/i,
  /<base\b/i,
  /<meta\b/i,
  
  // SVG-based XSS
  /<svg\b/i,
  
  // Template injection
  /\{\{.*\}\}/,
  /\$\{.*\}/,
]

/**
 * Check if a string contains potential XSS patterns
 * @param {string} str - String to check
 * @returns {boolean} True if XSS patterns detected
 */
export function containsXss(str) {
  if (typeof str !== 'string') return false
  return XSS_PATTERNS.some(pattern => pattern.test(str))
}

/**
 * Get list of XSS patterns found in string (for error messages)
 * @param {string} str - String to check
 * @returns {string[]} Array of pattern descriptions that matched
 */
export function getXssPatterns(str) {
  if (typeof str !== 'string') return []
  
  const found = []
  const descriptions = [
    'script tag', 'script close tag',
    'event handler', 
    'javascript: URL', 'vbscript: URL',
    'data: text/html URL',
    'CSS expression',
    'iframe tag', 'embed tag', 'object tag', 'form tag',
    'input tag', 'button tag', 'textarea tag', 'select tag',
    'link tag', 'style tag', 'base tag', 'meta tag',
    'svg tag',
    'template injection ({{}})', 'template injection (${})',
  ]
  
  XSS_PATTERNS.forEach((pattern, i) => {
    if (pattern.test(str)) {
      found.push(descriptions[i])
    }
  })
  
  return found
}

// =============================================================================
// Trusted Content Wrapper
// =============================================================================

const TRUSTED_SYMBOL = Symbol.for('yamf.security.trusted')

/**
 * Mark content as trusted (explicit XSS opt-out)
 * Use when content is known to be safe (e.g., from trusted source, already sanitized)
 * 
 * @param {string} content - The trusted content
 * @returns {Object} Trusted content wrapper
 * 
 * @example
 * // In Element rendering
 * div(trusted('<b>Safe HTML from CMS</b>'))
 * 
 * @example
 * // In validation
 * is(is.trusted, is.string())
 */
export function trusted(content) {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    console.warn(
      '[YAMF Security] trusted() used - XSS protection disabled for this content. ' +
      'Ensure the content source is trustworthy.'
    )
  }
  return {
    [TRUSTED_SYMBOL]: true,
    value: content,
    toString() { return String(content) }
  }
}

/**
 * Check if a value is marked as trusted
 * @param {*} val - Value to check
 * @returns {boolean} True if value is a trusted wrapper
 */
export function isTrusted(val) {
  return val != null && val[TRUSTED_SYMBOL] === true
}

/**
 * Unwrap a potentially trusted value
 * @param {*} val - Value to unwrap
 * @returns {*} The underlying value (unwrapped if trusted, original otherwise)
 */
export function unwrapTrusted(val) {
  return isTrusted(val) ? val.value : val
}

// =============================================================================
// HTML Attribute Validation
// =============================================================================

/**
 * Valid HTML attribute names (subset of commonly used attributes)
 * Prevents attribute injection attacks via dynamic attribute names
 */
export const validAttributes = new Set([
  // Global attributes
  'id', 'class', 'style', 'title', 'lang', 'dir', 'tabindex',
  'hidden', 'accesskey', 'draggable', 'contenteditable', 'spellcheck',
  'translate', 'autocapitalize', 'autofocus', 'enterkeyhint',
  'inputmode', 'is', 'itemid', 'itemprop', 'itemref', 'itemscope', 'itemtype',
  'nonce', 'part', 'slot', 'exportparts',
  
  // Links and navigation
  'href', 'target', 'rel', 'download', 'hreflang', 'ping', 'referrerpolicy',
  
  // Forms - input attributes
  'name', 'value', 'type', 'placeholder', 'required', 'disabled',
  'readonly', 'checked', 'selected', 'multiple', 'autofocus',
  'autocomplete', 'min', 'max', 'step', 'pattern', 'minlength', 'maxlength',
  'size', 'list', 'accept', 'capture', 'inputmode',
  
  // Forms - form attributes
  'action', 'method', 'enctype', 'novalidate', 'formaction', 'formmethod',
  'formenctype', 'formnovalidate', 'formtarget', 'form',
  
  // Forms - textarea/select
  'rows', 'cols', 'wrap', 'dirname',
  
  // Media - images
  'src', 'alt', 'width', 'height', 'loading', 'srcset', 'sizes',
  'crossorigin', 'decoding', 'ismap', 'usemap', 'fetchpriority',
  
  // Media - audio/video
  'autoplay', 'controls', 'loop', 'muted', 'poster', 'preload',
  'playsinline', 'disablepictureinpicture', 'disableremoteplayback',
  
  // Media - source/track
  'media', 'srclang', 'kind', 'label', 'default',
  
  // Tables
  'colspan', 'rowspan', 'headers', 'scope', 'abbr',
  
  // Meta/head
  'charset', 'content', 'http-equiv',
  
  // Misc
  'for', 'datetime', 'cite', 'open', 'reversed', 'start',
  'high', 'low', 'optimum', 'sandbox', 'allow', 'allowfullscreen',
  'loading', 'importance', 'integrity', 'as',
  
  // Deprecated but sometimes needed
  'border', 'cellpadding', 'cellspacing', 'align', 'valign', 'bgcolor',
])

/**
 * Validate an attribute name
 * Allows standard attributes, data-* attributes, and aria-* attributes
 * 
 * @param {string} name - Attribute name to validate
 * @returns {boolean} True if attribute name is valid
 */
export function isValidAttributeName(name) {
  if (typeof name !== 'string') return false
  
  const lowerName = name.toLowerCase()
  
  // Check standard attributes
  if (validAttributes.has(lowerName)) return true
  
  // Allow data-* attributes (must be lowercase letters, numbers, hyphens after 'data-')
  if (/^data-[a-z][a-z0-9-]*$/.test(lowerName)) return true
  
  // Allow aria-* attributes
  if (/^aria-[a-z]+$/.test(lowerName)) return true
  
  return false
}

/**
 * Check if an attribute name is an event handler (onclick, onerror, etc.)
 * These require special handling in Element rendering
 * 
 * @param {string} name - Attribute name to check
 * @returns {boolean} True if it's an event handler attribute
 */
export function isEventAttribute(name) {
  return typeof name === 'string' && /^on[a-z]+$/i.test(name)
}

// =============================================================================
// Sanitization (for "sanitize" mode)
// =============================================================================

/**
 * Sanitize a string by removing/encoding dangerous content
 * Used when xss mode is "sanitize"
 * 
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeHtml(str) {
  if (typeof str !== 'string') return ''
  
  // Encode HTML entities (this handles most XSS vectors)
  return encodeHtml(str)
}

/**
 * Sanitize HTML while preserving safe tags
 * Allows basic formatting: b, i, u, strong, em, br, p, span, a (with safe href)
 * 
 * @param {string} str - HTML string to sanitize
 * @returns {string} Sanitized HTML with safe tags preserved
 */
export function sanitizeHtmlAllowSafe(str) {
  if (typeof str !== 'string') return ''
  
  // Define safe tags and their allowed attributes
  const safeTags = {
    'b': [],
    'i': [],
    'u': [],
    'strong': [],
    'em': [],
    'br': [],
    'p': ['class'],
    'span': ['class'],
    'a': ['href', 'title', 'target'],
    'ul': ['class'],
    'ol': ['class'],
    'li': ['class'],
    'code': ['class'],
    'pre': ['class'],
    'blockquote': ['class'],
  }
  
  // First, encode everything
  let result = encodeHtml(str)
  
  // Then selectively decode safe tags
  for (const [tag, allowedAttrs] of Object.entries(safeTags)) {
    // Opening tags with attributes
    const openTagRegex = new RegExp(
      `&lt;(${tag})\\s*([^&]*?)&gt;`,
      'gi'
    )
    result = result.replace(openTagRegex, (match, tagName, attrs) => {
      // Parse and validate attributes
      const decodedAttrs = attrs
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&')
      
      // Simple attribute extraction
      const safeAttrs = []
      const attrRegex = /([a-z-]+)\s*=\s*["']([^"']*)["']/gi
      let attrMatch
      while ((attrMatch = attrRegex.exec(decodedAttrs)) !== null) {
        const [, attrName, attrValue] = attrMatch
        if (allowedAttrs.includes(attrName.toLowerCase())) {
          // For href, validate it's not javascript:
          if (attrName.toLowerCase() === 'href' && /^\s*javascript:/i.test(attrValue)) {
            continue
          }
          safeAttrs.push(`${attrName}="${encodeHtml(attrValue)}"`)
        }
      }
      
      const attrsStr = safeAttrs.length > 0 ? ' ' + safeAttrs.join(' ') : ''
      return `<${tagName}${attrsStr}>`
    })
    
    // Self-closing tags (for void elements like br)
    const selfCloseRegex = new RegExp(`&lt;${tag}\\s*/?&gt;`, 'gi')
    result = result.replace(selfCloseRegex, `<${tag}>`)
    
    // Closing tags
    const closeRegex = new RegExp(`&lt;/${tag}&gt;`, 'gi')
    result = result.replace(closeRegex, `</${tag}>`)
  }
  
  return result
}

// =============================================================================
// Export
// =============================================================================

export const encode = {
  html: encodeHtml,
  attr: encodeAttr,
}

export const detect = {
  containsXss,
  getXssPatterns,
}

export const sanitize = {
  html: sanitizeHtml,
  htmlAllowSafe: sanitizeHtmlAllowSafe,
}

export default {
  encode,
  detect,
  sanitize,
  trusted,
  isTrusted,
  unwrapTrusted,
  validAttributes,
  isValidAttributeName,
  isEventAttribute,
}
