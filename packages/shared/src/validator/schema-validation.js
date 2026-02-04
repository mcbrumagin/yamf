/**
 * Schema Validation
 * 
 * Validates schemas themselves to catch illogical configurations at creation time.
 * This prevents runtime surprises from schemas that can never pass or always pass.
 */

import { SchemaError } from './errors.js'
import { SCHEMA_SYMBOL, isSchema } from './is.js'

/**
 * Validate a schema object, throwing SchemaError if invalid
 * 
 * @param {Object} schema - The schema to validate
 * @param {string} path - Current path (for error messages)
 * @throws {SchemaError} If schema is invalid
 */
export function validateSchema(schema, path = '') {
  if (!schema || typeof schema !== 'object') {
    throw new SchemaError('Schema must be an object', path)
  }

  // Handle plain objects as nested object schemas
  if (!isSchema(schema)) {
    // It's a plain object - treat as object schema
    for (const [key, value] of Object.entries(schema)) {
      const childPath = path ? `${path}.${key}` : key
      if (value && typeof value === 'object') {
        validateSchema(value, childPath)
      }
    }
    return
  }

  const { type } = schema

  // Dispatch to type-specific validation
  switch (type) {
    case 'string':
      validateStringSchema(schema, path)
      break
    case 'int':
    case 'number':
      validateNumericSchema(schema, path)
      break
    case 'array':
      validateArraySchema(schema, path)
      break
    case 'object':
      validateObjectSchema(schema, path)
      break
    case 'oneOf':
      validateOneOfSchema(schema, path)
      break
    case 'anyOf':
    case 'allOf':
      validateCompositeSchema(schema, path)
      break
    case 'date':
    case 'datetime':
      validateDateSchema(schema, path)
      break
    case 'password':
      validatePasswordSchema(schema, path)
      break
    case 'literal':
      validateLiteralSchema(schema, path)
      break
    case 'custom':
      validateCustomSchema(schema, path)
      break
    case 'modifier':
    case 'bool':
    case 'email':
    case 'url':
    case 'any':
      // These have no constraints to validate
      break
    default:
      // Unknown type - could be extended, allow it
      break
  }
}

/**
 * Validate string schema constraints
 */
function validateStringSchema(schema, path) {
  const { minLength, maxLength, pattern } = schema

  if (minLength !== undefined) {
    if (typeof minLength !== 'number' || !Number.isInteger(minLength)) {
      throw new SchemaError('minLength must be an integer', path)
    }
    if (minLength < 0) {
      throw new SchemaError('minLength cannot be negative', path)
    }
  }

  if (maxLength !== undefined) {
    if (typeof maxLength !== 'number' || !Number.isInteger(maxLength)) {
      throw new SchemaError('maxLength must be an integer', path)
    }
    if (maxLength < 0) {
      throw new SchemaError('maxLength cannot be negative', path)
    }
  }

  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    throw new SchemaError(`minLength (${minLength}) cannot be greater than maxLength (${maxLength})`, path)
  }

  if (pattern !== undefined) {
    if (typeof pattern !== 'string' && !(pattern instanceof RegExp)) {
      throw new SchemaError('pattern must be a string or RegExp', path)
    }
  }
}

/**
 * Validate numeric schema constraints
 */
function validateNumericSchema(schema, path) {
  const { min, max, positive, negative } = schema

  if (min !== undefined && typeof min !== 'number') {
    throw new SchemaError('min must be a number', path)
  }

  if (max !== undefined && typeof max !== 'number') {
    throw new SchemaError('max must be a number', path)
  }

  if (min !== undefined && max !== undefined && min > max) {
    throw new SchemaError(`min (${min}) cannot be greater than max (${max})`, path)
  }

  if (positive === true && negative === true) {
    throw new SchemaError('Cannot require both positive and negative', path)
  }

  if (positive === true && max !== undefined && max <= 0) {
    throw new SchemaError('positive constraint conflicts with max <= 0', path)
  }

  if (negative === true && min !== undefined && min >= 0) {
    throw new SchemaError('negative constraint conflicts with min >= 0', path)
  }
}

/**
 * Validate array schema constraints
 */
function validateArraySchema(schema, path) {
  const { items, minLength, maxLength } = schema

  if (minLength !== undefined) {
    if (typeof minLength !== 'number' || !Number.isInteger(minLength)) {
      throw new SchemaError('minLength must be an integer', path)
    }
    if (minLength < 0) {
      throw new SchemaError('minLength cannot be negative', path)
    }
  }

  if (maxLength !== undefined) {
    if (typeof maxLength !== 'number' || !Number.isInteger(maxLength)) {
      throw new SchemaError('maxLength must be an integer', path)
    }
    if (maxLength < 0) {
      throw new SchemaError('maxLength cannot be negative', path)
    }
  }

  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    throw new SchemaError(`minLength (${minLength}) cannot be greater than maxLength (${maxLength})`, path)
  }

  // Validate item schema if provided
  if (items) {
    validateSchema(items, `${path}[]`)
  }
}

/**
 * Validate object schema constraints
 */
function validateObjectSchema(schema, path) {
  const { properties } = schema

  if (properties) {
    if (typeof properties !== 'object' || Array.isArray(properties)) {
      throw new SchemaError('properties must be an object', path)
    }
    
    for (const [key, value] of Object.entries(properties)) {
      validateSchema(value, path ? `${path}.${key}` : key)
    }
  }
}

/**
 * Validate oneOf schema
 */
function validateOneOfSchema(schema, path) {
  const { values } = schema

  if (!Array.isArray(values)) {
    throw new SchemaError('oneOf values must be an array', path)
  }

  if (values.length === 0) {
    throw new SchemaError('oneOf requires at least one value', path)
  }

  // Check for duplicate values
  const seen = new Set()
  for (const val of values) {
    const key = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (seen.has(key)) {
      throw new SchemaError(`oneOf contains duplicate value: ${key}`, path)
    }
    seen.add(key)
  }
}

/**
 * Validate anyOf/allOf schemas
 */
function validateCompositeSchema(schema, path) {
  const { schemas, type } = schema

  if (!Array.isArray(schemas)) {
    throw new SchemaError(`${type} schemas must be an array`, path)
  }

  if (schemas.length === 0) {
    throw new SchemaError(`${type} requires at least one schema`, path)
  }

  schemas.forEach((s, i) => {
    validateSchema(s, `${path}[${i}]`)
  })
}

/**
 * Validate date/datetime schema
 */
function validateDateSchema(schema, path) {
  const { min, max } = schema

  // 'now' is a valid special value
  if (min !== undefined && min !== 'now' && typeof min !== 'string') {
    throw new SchemaError('min must be a date string or "now"', path)
  }

  if (max !== undefined && max !== 'now' && typeof max !== 'string') {
    throw new SchemaError('max must be a date string or "now"', path)
  }

  // If both are date strings (not 'now'), validate order
  if (min && max && min !== 'now' && max !== 'now') {
    const minDate = new Date(min)
    const maxDate = new Date(max)
    if (isNaN(minDate.getTime())) {
      throw new SchemaError(`Invalid min date: ${min}`, path)
    }
    if (isNaN(maxDate.getTime())) {
      throw new SchemaError(`Invalid max date: ${max}`, path)
    }
    if (minDate > maxDate) {
      throw new SchemaError(`min date (${min}) cannot be after max date (${max})`, path)
    }
  }
}

/**
 * Validate password schema
 */
function validatePasswordSchema(schema, path) {
  const { minLength } = schema

  if (minLength !== undefined) {
    if (typeof minLength !== 'number' || !Number.isInteger(minLength)) {
      throw new SchemaError('minLength must be an integer', path)
    }
    if (minLength < 1) {
      throw new SchemaError('password minLength must be at least 1', path)
    }
  }
}

/**
 * Validate literal schema
 */
function validateLiteralSchema(schema, path) {
  if (!('value' in schema)) {
    throw new SchemaError('literal schema requires a value', path)
  }
}

/**
 * Validate custom schema
 */
function validateCustomSchema(schema, path) {
  const { validate } = schema

  if (typeof validate !== 'function') {
    throw new SchemaError('custom schema requires a validate function', path)
  }
}
