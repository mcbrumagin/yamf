/**
 * The `is` Validator API
 * 
 * `is` serves dual purposes:
 * 1. As a namespace for type builders: is.string(), is.int, is.email
 * 2. As a composer function: is(is.optional, is.string({ maxLength: 50 }))
 * 
 * All type builders return plain schema objects (declarative, serializable).
 * 
 * XSS Protection:
 * By default, all string types use xss: 'check' which fails validation if
 * XSS patterns are detected. This teaches developers about security issues
 * and forces explicit decisions:
 * - xss: 'check' (default) - Fail if XSS detected
 * - xss: 'sanitize' - Encode dangerous characters
 * - xss: false - Disable XSS checks (use is.unsafeString)
 */

// Schema type symbols for identification
export const SCHEMA_SYMBOL = Symbol.for('yamf.validator.schema')

/**
 * Mark an object as a schema
 */
function schema(type, opts = {}) {
  return {
    [SCHEMA_SYMBOL]: true,
    type,
    ...opts
  }
}

/**
 * Check if a value is a schema object
 */
export function isSchema(val) {
  return val && typeof val === 'object' && val[SCHEMA_SYMBOL] === true
}

/**
 * The `is` composer function
 * Merges multiple schemas or schema fragments into one
 * 
 * @param {...(Object|Function)} schemas - Schemas to merge (left to right)
 * @returns {Object} Merged schema object
 * 
 * @example
 * is(is.optional, is.string({ maxLength: 50 }))
 * is(is.int, { min: 0, max: 100 })
 */
function is(...schemas) {
  if (schemas.length === 0) {
    throw new Error('is() requires at least one schema argument')
  }
  
  return schemas.reduce((merged, item) => {
    // Handle functions (type builders called without parens)
    if (typeof item === 'function') {
      item = item()
    }
    
    // Handle plain objects (constraint overrides)
    if (item && typeof item === 'object') {
      return { ...merged, ...item }
    }
    
    throw new Error(`Invalid schema item: ${typeof item}`)
  }, { [SCHEMA_SYMBOL]: true })
}

// =============================================================================
// Type Builders
// =============================================================================

/**
 * String type
 * Constraints: minLength, maxLength, pattern, trim, lowercase, uppercase
 * 
 * XSS Protection (default: 'check'):
 * - xss: 'check' - Fail validation if XSS patterns detected (default)
 * - xss: 'sanitize' - Encode dangerous characters in output
 * - xss: false - Disable XSS checks (use is.unsafeString instead)
 */
is.string = function string(opts = {}) {
  // Default to XSS check mode for security
  return schema('string', { xss: 'check', ...opts })
}

/**
 * Unsafe string type - explicitly disables XSS protection
 * Use when you need raw string input without XSS checks.
 * 
 * WARNING: Only use when you trust the input source or will sanitize manually.
 * A warning is logged in non-production environments.
 */
is.unsafeString = function unsafeString(opts = {}) {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    // Warning is logged at validation time, not schema creation time
  }
  return schema('string', { ...opts, xss: false, __unsafe__: true })
}

/**
 * Integer type
 * Constraints: min, max, positive, negative
 */
is.int = function int(opts = {}) {
  return schema('int', opts)
}

/**
 * Number type (float)
 * Constraints: min, max, positive, negative
 */
is.number = function number(opts = {}) {
  return schema('number', opts)
}

/**
 * Boolean type
 */
is.bool = schema('bool')

/**
 * Email type (string with email pattern)
 * XSS protection enabled by default
 */
is.email = schema('email', { xss: 'check' })

/**
 * URL type (string with URL pattern)
 * XSS protection enabled by default
 */
is.url = schema('url', { xss: 'check' })

/**
 * Date type (ISO date string: YYYY-MM-DD)
 */
is.date = function date(opts = {}) {
  return schema('date', opts)
}

/**
 * DateTime type (ISO datetime string)
 * Constraints: min, max (can use 'now' as special value)
 */
is.datetime = function datetime(opts = {}) {
  return schema('datetime', opts)
}

/**
 * Array type
 * @param {Object} itemSchema - Schema for array items
 * @param {Object} opts - Constraints: minLength, maxLength, unique
 */
is.array = function array(itemSchema, opts = {}) {
  // Handle is.array({ minLength: 1 }) without item schema
  if (itemSchema && !isSchema(itemSchema) && typeof itemSchema === 'object' && !itemSchema.type) {
    opts = itemSchema
    itemSchema = undefined
  }
  return schema('array', { items: itemSchema, ...opts })
}

/**
 * Object type (for explicit object schemas)
 * @param {Object} properties - Property schemas
 * @param {Object} opts - Constraints: strict (no extra properties)
 */
is.object = function object(properties = {}, opts = {}) {
  return schema('object', { properties, ...opts })
}

/**
 * Literal value (exact match)
 * @param {*} value - The exact value to match
 */
is.literal = function literal(value) {
  return schema('literal', { value })
}

/**
 * One of specific values (enum)
 * @param {...*} values - Allowed values
 */
is.oneOf = function oneOf(...values) {
  // Handle array passed as single argument
  if (values.length === 1 && Array.isArray(values[0])) {
    values = values[0]
  }
  return schema('oneOf', { values })
}

/**
 * Any of multiple schemas (union type)
 * @param {...Object} schemas - Schemas where at least one must match
 */
is.anyOf = function anyOf(...schemas) {
  return schema('anyOf', { schemas: schemas.map(s => typeof s === 'function' ? s() : s) })
}

/**
 * All of multiple schemas (intersection)
 * @param {...Object} schemas - All schemas must match
 */
is.allOf = function allOf(...schemas) {
  return schema('allOf', { schemas: schemas.map(s => typeof s === 'function' ? s() : s) })
}

// =============================================================================
// Modifiers
// =============================================================================

/**
 * Optional modifier - value can be undefined/missing
 */
is.optional = schema('modifier', { optional: true })

/**
 * Nullable modifier - value can be null
 */
is.nullable = schema('modifier', { nullable: true })

/**
 * Nilable modifier - value can be null or undefined
 */
is.nilable = schema('modifier', { nullable: true, optional: true })

/**
 * Trusted modifier - marks content as trusted (disables XSS checks)
 * Use when content comes from a trusted source (e.g., CMS, admin input)
 * 
 * WARNING: This disables XSS protection. Only use for genuinely trusted content.
 * A warning is logged in non-production environments.
 * 
 * @example
 * is(is.trusted, is.string()) // XSS checks disabled for this field
 */
is.trusted = schema('modifier', { xss: false, __trusted__: true })

// =============================================================================
// Custom Validation
// =============================================================================

/**
 * Custom validation function
 * @param {Function} fn - Validation function (value) => boolean
 * @param {string} message - Error message if validation fails
 */
is.custom = function custom(fn, message = 'Custom validation failed') {
  if (typeof fn !== 'function') {
    throw new Error('is.custom() requires a validation function')
  }
  return schema('custom', { validate: fn, message })
}

/**
 * Add a custom validation to any schema
 * @param {Object} baseSchema - The base schema
 * @param {Function} fn - Validation function
 * @param {string} message - Error message
 */
is.refine = function refine(baseSchema, fn, message = 'Refinement validation failed') {
  const base = typeof baseSchema === 'function' ? baseSchema() : baseSchema
  return {
    ...base,
    refine: { validate: fn, message }
  }
}

// =============================================================================
// Patterns (pre-defined string patterns)
// =============================================================================

is.patterns = {
  alphanumeric: /^[a-zA-Z0-9]+$/,
  alpha: /^[a-zA-Z]+$/,
  numeric: /^[0-9]+$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  hex: /^[0-9a-fA-F]+$/,
  base64: /^[A-Za-z0-9+/]*={0,2}$/,
  // Basic patterns - full validation done by type validators
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/.+/,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
  phone: /^\+?[\d\s-()]+$/,
}

/**
 * String with alphanumeric pattern
 * XSS protection enabled by default
 */
is.alphanumeric = function alphanumeric(opts = {}) {
  return schema('string', { xss: 'check', pattern: 'alphanumeric', ...opts })
}

/**
 * UUID string
 * XSS protection enabled by default
 */
is.uuid = schema('string', { xss: 'check', pattern: 'uuid' })

/**
 * Base64 encoded string
 * XSS protection enabled by default
 */
is.base64 = function base64(opts = {}) {
  return schema('string', { xss: 'check', pattern: 'base64', ...opts })
}

/**
 * Slug string (lowercase, hyphens)
 * XSS protection enabled by default
 */
is.slug = function slug(opts = {}) {
  return schema('string', { xss: 'check', pattern: 'slug', ...opts })
}

// =============================================================================
// Password type with common constraints
// =============================================================================

/**
 * Password type with configurable strength requirements
 * XSS protection enabled by default (passwords can contain special chars)
 * @param {Object} opts - minLength, requireUppercase, requireLowercase, requireNumber, requireSpecial
 */
is.password = function password(opts = {}) {
  return schema('password', {
    xss: 'check',
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
    ...opts
  })
}

// =============================================================================
// Any type (escape hatch)
// =============================================================================

/**
 * Any type - accepts any value (use sparingly)
 */
is.any = schema('any')

// =============================================================================
// Export
// =============================================================================

export { is }
export default is
