/**
 * @yamf/shared Validator
 * 
 * A declarative, composable validation library for client and server.
 * 
 * @example
 * import { is, createValidator } from '@yamf/shared/validator'
 * 
 * const userSchema = {
 *   name: is.string({ minLength: 1, maxLength: 100 }),
 *   email: is.email,
 *   age: is.int({ min: 0, max: 150 }),
 *   role: is.oneOf('admin', 'user', 'guest'),
 *   preferences: {
 *     theme: is.oneOf('dark', 'light'),
 *     notifications: is.bool,
 *   }
 * }
 * 
 * const validateUser = createValidator(userSchema)
 * validateUser(userData) // throws ValidationError if invalid
 * 
 * // Or use validate() directly for result object
 * const { valid, failures, data } = validate(userData, userSchema)
 */

import { is, isSchema, SCHEMA_SYMBOL } from './is.js'
import { validate } from './validate.js'
import { validateSchema } from './schema-validation.js'
import { ValidationError, ValidationFailure, SchemaError } from './errors.js'
import xss, { 
  trusted, 
  isTrusted, 
  encode, 
  sanitize, 
  detect,
  validAttributes,
  isValidAttributeName,
  isEventAttribute 
} from '../security/xss.js'

/**
 * Create a reusable validator function from a schema
 * 
 * @param {Object} schema - The validation schema
 * @param {Object} options - Validator options
 * @param {string} options.name - Name for error messages
 * @param {boolean} options.strict - Disallow extra properties on objects
 * @returns {Function} Validator function that throws ValidationError on failure
 * 
 * @example
 * const validateUser = createValidator(userSchema, { name: 'User' })
 * validateUser(data) // throws if invalid
 */
export function createValidator(schema, options = {}) {
  const { name = null, strict = false } = options
  
  // Validate the schema itself at creation time
  validateSchema(schema)
  
  // Apply strict option to root if it's an object schema
  if (strict && !isSchema(schema)) {
    // Plain object - wrap in object schema with strict
    schema = { ...schema, strict: true }
  }
  
  /**
   * Validator function
   * @param {*} data - Data to validate
   * @returns {*} The validated (and possibly transformed) data
   * @throws {ValidationError} If validation fails
   */
  function validator(data) {
    const result = validate(data, schema)
    
    if (!result.valid) {
      throw new ValidationError(result.failures, name)
    }
    
    return result.data
  }
  
  // Attach schema for introspection
  validator.schema = schema
  validator.schemaName = name
  
  // Add helper methods
  validator.validate = (data) => validate(data, schema)
  validator.isValid = (data) => validate(data, schema).valid
  
  return validator
}

/**
 * Validate data and return result object (doesn't throw)
 * 
 * @param {*} data - Data to validate
 * @param {Object} schema - Schema to validate against
 * @returns {{ valid: boolean, failures: ValidationFailure[], data: * }}
 */
export { validate }

/**
 * Check if a value is a valid schema object
 */
export { isSchema }

/**
 * The `is` namespace/composer
 */
export { is }

/**
 * Error classes
 */
export { ValidationError, ValidationFailure, SchemaError }

/**
 * Schema symbol for identification
 */
export { SCHEMA_SYMBOL }

/**
 * XSS utilities
 */
export { 
  xss,
  trusted, 
  isTrusted, 
  encode, 
  sanitize, 
  detect,
  validAttributes,
  isValidAttributeName,
  isEventAttribute 
}

// Default export is `is` for convenient usage
export default is
