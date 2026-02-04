/**
 * Data Validation
 * 
 * Runtime validation of data against schemas.
 * Collects all failures rather than failing on first error.
 */

import { ValidationFailure, ValidationError } from './errors.js'
import { SCHEMA_SYMBOL, isSchema, is } from './is.js'
import { containsXss, getXssPatterns, encodeHtml } from '../security/xss.js'

/**
 * Validate data against a schema
 * 
 * @param {*} data - The data to validate
 * @param {Object} schema - The schema to validate against
 * @param {Object} options - Validation options
 * @returns {{ valid: boolean, failures: ValidationFailure[], data: * }}
 */
export function validate(data, schema, options = {}) {
  const failures = []
  const path = options.path || ''
  
  // Run transformers first if present
  if (schema.transform) {
    data = applyTransformers(data, schema.transform)
  }
  
  // Extract modifiers
  const isOptional = schema.optional === true
  const isNullable = schema.nullable === true
  
  // Handle undefined
  if (data === undefined) {
    if (!isOptional) {
      failures.push(new ValidationFailure(path, data, 'required', 'Value is required'))
    }
    return { valid: failures.length === 0, failures, data }
  }
  
  // Handle null
  if (data === null) {
    if (!isNullable) {
      failures.push(new ValidationFailure(path, data, 'nullable', 'Value cannot be null'))
    }
    return { valid: failures.length === 0, failures, data }
  }
  
  // Handle plain objects (nested schemas)
  if (!isSchema(schema)) {
    if (typeof schema === 'object' && schema !== null) {
      // It's a nested object schema
      return validateObject(data, schema, path)
    }
    // Primitive value - just return valid
    return { valid: true, failures: [], data }
  }
  
  // Dispatch to type-specific validators
  const { type } = schema
  
  switch (type) {
    case 'string':
      data = validateString(data, schema, path, failures)
      break
    case 'int':
      validateInt(data, schema, path, failures)
      break
    case 'number':
      validateNumber(data, schema, path, failures)
      break
    case 'bool':
      validateBool(data, schema, path, failures)
      break
    case 'email':
      data = validateEmail(data, schema, path, failures)
      break
    case 'url':
      data = validateUrl(data, schema, path, failures)
      break
    case 'date':
      validateDate(data, schema, path, failures)
      break
    case 'datetime':
      validateDateTime(data, schema, path, failures)
      break
    case 'array':
      validateArray(data, schema, path, failures)
      break
    case 'object':
      const result = validateObject(data, schema.properties || {}, path, schema.strict)
      failures.push(...result.failures)
      data = result.data
      break
    case 'literal':
      validateLiteral(data, schema, path, failures)
      break
    case 'oneOf':
      validateOneOf(data, schema, path, failures)
      break
    case 'anyOf':
      validateAnyOf(data, schema, path, failures)
      break
    case 'allOf':
      validateAllOf(data, schema, path, failures)
      break
    case 'password':
      data = validatePassword(data, schema, path, failures)
      break
    case 'custom':
      validateCustom(data, schema, path, failures)
      break
    case 'modifier':
      // Modifiers don't validate anything themselves
      break
    case 'any':
      // Any accepts anything
      break
    default:
      // Unknown type - skip validation
      break
  }
  
  // Run refinement if present
  if (schema.refine && failures.length === 0) {
    const { validate: refineFn, message } = schema.refine
    try {
      if (!refineFn(data)) {
        failures.push(new ValidationFailure(path, data, 'refine', message))
      }
    } catch (err) {
      failures.push(new ValidationFailure(path, data, 'refine', err.message || message))
    }
  }
  
  return { valid: failures.length === 0, failures, data }
}

// =============================================================================
// Type Validators
// =============================================================================

function validateString(data, schema, path, failures) {
  if (typeof data !== 'string') {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected a string'))
    return data
  }
  
  const { minLength, maxLength, pattern, xss, __unsafe__, __trusted__ } = schema
  
  // XSS validation (default is 'check')
  if (xss !== false && !__trusted__) {
    if (xss === 'check' || xss === undefined) {
      // Check mode: fail if XSS detected
      if (containsXss(data)) {
        const patterns = getXssPatterns(data)
        failures.push(new ValidationFailure(path, '[XSS content hidden]', 'xss', 
          `Potential XSS detected: ${patterns.join(', ')}. ` +
          `Use is.unsafeString() if this content is trusted, or xss: 'sanitize' to encode it.`))
      }
    } else if (xss === 'sanitize') {
      // Sanitize mode: encode dangerous characters
      data = encodeHtml(data)
    }
  } else if (__unsafe__ && typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    // Log warning for unsafe string usage in non-production
    console.warn(
      `[YAMF Security] is.unsafeString used at path "${path || 'root'}". ` +
      `XSS protection is disabled. Ensure input is from a trusted source.`
    )
  }
  
  if (minLength !== undefined && data.length < minLength) {
    failures.push(new ValidationFailure(path, data, 'minLength', 
      `String must be at least ${minLength} characters`))
  }
  
  if (maxLength !== undefined && data.length > maxLength) {
    failures.push(new ValidationFailure(path, data, 'maxLength', 
      `String must be at most ${maxLength} characters`))
  }
  
  if (pattern !== undefined) {
    const regex = typeof pattern === 'string' 
      ? is.patterns[pattern] || new RegExp(pattern)
      : pattern
    
    if (regex && !regex.test(data)) {
      const patternName = typeof pattern === 'string' ? pattern : 'pattern'
      failures.push(new ValidationFailure(path, data, 'pattern', 
        `String does not match ${patternName}`))
    }
  }
  
  return data
}

function validateInt(data, schema, path, failures) {
  if (typeof data !== 'number' || !Number.isInteger(data)) {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected an integer'))
    return
  }
  
  validateNumericConstraints(data, schema, path, failures)
}

function validateNumber(data, schema, path, failures) {
  if (typeof data !== 'number' || Number.isNaN(data)) {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected a number'))
    return
  }
  
  validateNumericConstraints(data, schema, path, failures)
}

function validateNumericConstraints(data, schema, path, failures) {
  const { min, max, positive, negative } = schema
  
  if (min !== undefined && data < min) {
    failures.push(new ValidationFailure(path, data, 'min', 
      `Value must be at least ${min}`))
  }
  
  if (max !== undefined && data > max) {
    failures.push(new ValidationFailure(path, data, 'max', 
      `Value must be at most ${max}`))
  }
  
  if (positive === true && data <= 0) {
    failures.push(new ValidationFailure(path, data, 'positive', 
      'Value must be positive'))
  }
  
  if (negative === true && data >= 0) {
    failures.push(new ValidationFailure(path, data, 'negative', 
      'Value must be negative'))
  }
}

function validateBool(data, schema, path, failures) {
  if (typeof data !== 'boolean') {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected a boolean'))
  }
}

function validateEmail(data, schema, path, failures) {
  if (typeof data !== 'string') {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected a string'))
    return data
  }
  
  // XSS check (emails shouldn't contain XSS vectors)
  const { xss } = schema
  if (xss !== false) {
    if (containsXss(data)) {
      const patterns = getXssPatterns(data)
      failures.push(new ValidationFailure(path, '[XSS content hidden]', 'xss', 
        `Potential XSS detected in email: ${patterns.join(', ')}`))
    }
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(data)) {
    failures.push(new ValidationFailure(path, data, 'email', 'Invalid email address'))
  }
  
  return data
}

function validateUrl(data, schema, path, failures) {
  if (typeof data !== 'string') {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected a string'))
    return data
  }
  
  // XSS check (reject javascript: URLs, etc.)
  const { xss } = schema
  if (xss !== false) {
    if (containsXss(data)) {
      const patterns = getXssPatterns(data)
      failures.push(new ValidationFailure(path, '[XSS content hidden]', 'xss', 
        `Potential XSS detected in URL: ${patterns.join(', ')}`))
      return data
    }
  }
  
  try {
    new URL(data)
  } catch {
    failures.push(new ValidationFailure(path, data, 'url', 'Invalid URL'))
  }
  
  return data
}

function validateDate(data, schema, path, failures) {
  if (typeof data !== 'string') {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected a date string'))
    return
  }
  
  // ISO date format: YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(data)) {
    failures.push(new ValidationFailure(path, data, 'date', 
      'Invalid date format (expected YYYY-MM-DD)'))
    return
  }
  
  const date = new Date(data)
  if (isNaN(date.getTime())) {
    failures.push(new ValidationFailure(path, data, 'date', 'Invalid date'))
    return
  }
  
  validateDateConstraints(date, data, schema, path, failures)
}

function validateDateTime(data, schema, path, failures) {
  if (typeof data !== 'string') {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected a datetime string'))
    return
  }
  
  const date = new Date(data)
  if (isNaN(date.getTime())) {
    failures.push(new ValidationFailure(path, data, 'datetime', 'Invalid datetime'))
    return
  }
  
  validateDateConstraints(date, data, schema, path, failures)
}

function validateDateConstraints(date, data, schema, path, failures) {
  const { min, max } = schema
  const now = new Date()
  
  if (min !== undefined) {
    const minDate = min === 'now' ? now : new Date(min)
    if (date < minDate) {
      failures.push(new ValidationFailure(path, data, 'min', 
        `Date must be on or after ${min === 'now' ? 'now' : min}`))
    }
  }
  
  if (max !== undefined) {
    const maxDate = max === 'now' ? now : new Date(max)
    if (date > maxDate) {
      failures.push(new ValidationFailure(path, data, 'max', 
        `Date must be on or before ${max === 'now' ? 'now' : max}`))
    }
  }
}

function validateArray(data, schema, path, failures) {
  if (!Array.isArray(data)) {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected an array'))
    return
  }
  
  const { items, minLength, maxLength, unique } = schema
  
  if (minLength !== undefined && data.length < minLength) {
    failures.push(new ValidationFailure(path, data, 'minLength', 
      `Array must have at least ${minLength} items`))
  }
  
  if (maxLength !== undefined && data.length > maxLength) {
    failures.push(new ValidationFailure(path, data, 'maxLength', 
      `Array must have at most ${maxLength} items`))
  }
  
  if (unique === true) {
    const seen = new Set()
    for (let i = 0; i < data.length; i++) {
      const key = typeof data[i] === 'object' ? JSON.stringify(data[i]) : data[i]
      if (seen.has(key)) {
        failures.push(new ValidationFailure(`${path}[${i}]`, data[i], 'unique', 
          'Array must contain unique values'))
        break
      }
      seen.add(key)
    }
  }
  
  // Validate each item against item schema
  if (items) {
    for (let i = 0; i < data.length; i++) {
      const itemResult = validate(data[i], items, { path: `${path}[${i}]` })
      failures.push(...itemResult.failures)
    }
  }
}

function validateObject(data, properties, path, strict = false) {
  const failures = []
  
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected an object'))
    return { valid: false, failures, data }
  }
  
  // Validate each property
  for (const [key, propSchema] of Object.entries(properties)) {
    const propPath = path ? `${path}.${key}` : key
    const propValue = data[key]
    
    const result = validate(propValue, propSchema, { path: propPath })
    failures.push(...result.failures)
  }
  
  // Check for extra properties in strict mode
  if (strict) {
    const schemaKeys = new Set(Object.keys(properties))
    for (const key of Object.keys(data)) {
      if (!schemaKeys.has(key)) {
        const propPath = path ? `${path}.${key}` : key
        failures.push(new ValidationFailure(propPath, data[key], 'strict', 
          `Unexpected property "${key}"`))
      }
    }
  }
  
  return { valid: failures.length === 0, failures, data }
}

function validateLiteral(data, schema, path, failures) {
  const { value } = schema
  
  if (data !== value) {
    failures.push(new ValidationFailure(path, data, 'literal', 
      `Expected exactly: ${JSON.stringify(value)}`))
  }
}

function validateOneOf(data, schema, path, failures) {
  const { values } = schema
  
  const matches = values.some(v => {
    if (typeof v === 'object') {
      return JSON.stringify(data) === JSON.stringify(v)
    }
    return data === v
  })
  
  if (!matches) {
    const allowed = values.map(v => JSON.stringify(v)).join(', ')
    failures.push(new ValidationFailure(path, data, 'oneOf', 
      `Value must be one of: ${allowed}`))
  }
}

function validateAnyOf(data, schema, path, failures) {
  const { schemas } = schema
  
  // At least one schema must match
  const results = schemas.map(s => validate(data, s, { path }))
  const anyValid = results.some(r => r.valid)
  
  if (!anyValid) {
    failures.push(new ValidationFailure(path, data, 'anyOf', 
      'Value does not match any of the allowed schemas'))
  }
}

function validateAllOf(data, schema, path, failures) {
  const { schemas } = schema
  
  // All schemas must match
  for (const s of schemas) {
    const result = validate(data, s, { path })
    failures.push(...result.failures)
  }
}

function validatePassword(data, schema, path, failures) {
  if (typeof data !== 'string') {
    failures.push(new ValidationFailure(path, data, 'type', 'Expected a string'))
    return data
  }
  
  const { 
    minLength = 8, 
    requireUppercase, 
    requireLowercase, 
    requireNumber, 
    requireSpecial,
    xss
  } = schema
  
  // XSS check for passwords (unlikely but possible vector)
  if (xss !== false) {
    if (containsXss(data)) {
      const patterns = getXssPatterns(data)
      failures.push(new ValidationFailure(path, '[hidden]', 'xss', 
        `Potential XSS detected in password: ${patterns.join(', ')}`))
    }
  }
  
  if (data.length < minLength) {
    failures.push(new ValidationFailure(path, '[hidden]', 'minLength', 
      `Password must be at least ${minLength} characters`))
  }
  
  if (requireUppercase && !/[A-Z]/.test(data)) {
    failures.push(new ValidationFailure(path, '[hidden]', 'uppercase', 
      'Password must contain at least one uppercase letter'))
  }
  
  if (requireLowercase && !/[a-z]/.test(data)) {
    failures.push(new ValidationFailure(path, '[hidden]', 'lowercase', 
      'Password must contain at least one lowercase letter'))
  }
  
  if (requireNumber && !/\d/.test(data)) {
    failures.push(new ValidationFailure(path, '[hidden]', 'number', 
      'Password must contain at least one number'))
  }
  
  if (requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(data)) {
    failures.push(new ValidationFailure(path, '[hidden]', 'special', 
      'Password must contain at least one special character'))
  }
  
  return data
}

function validateCustom(data, schema, path, failures) {
  const { validate: validateFn, message } = schema
  
  try {
    const result = validateFn(data)
    if (result === false) {
      failures.push(new ValidationFailure(path, data, 'custom', message))
    }
  } catch (err) {
    failures.push(new ValidationFailure(path, data, 'custom', err.message || message))
  }
}

// =============================================================================
// Transformers
// =============================================================================

const builtInTransformers = {
  trim: (val) => typeof val === 'string' ? val.trim() : val,
  lowercase: (val) => typeof val === 'string' ? val.toLowerCase() : val,
  uppercase: (val) => typeof val === 'string' ? val.toUpperCase() : val,
  toInt: (val) => parseInt(val, 10),
  toFloat: (val) => parseFloat(val),
  toNumber: (val) => Number(val),
  toString: (val) => String(val),
  toBoolean: (val) => Boolean(val),
  toArray: (val) => Array.isArray(val) ? val : [val],
  toDate: (val) => new Date(val),
  default: (defaultValue) => (val) => val === undefined ? defaultValue : val,
}

function applyTransformers(data, transformers) {
  if (!Array.isArray(transformers)) {
    transformers = [transformers]
  }
  
  for (const transformer of transformers) {
    if (typeof transformer === 'string') {
      // Built-in transformer
      const fn = builtInTransformers[transformer]
      if (fn) {
        data = fn(data)
      }
    } else if (typeof transformer === 'function') {
      // Custom transformer
      data = transformer(data)
    } else if (Array.isArray(transformer) && transformer.length === 2) {
      // Parameterized built-in: ['default', 'value']
      const [name, arg] = transformer
      const factory = builtInTransformers[name]
      if (typeof factory === 'function') {
        const fn = factory(arg)
        if (typeof fn === 'function') {
          data = fn(data)
        }
      }
    }
  }
  
  return data
}
