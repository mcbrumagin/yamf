/**
 * @yamf/shared
 * 
 * Shared utilities for YAMF - truly isomorphic code that works in both browser and Node.js.
 */

// Validator exports
export { 
  is, 
  createValidator, 
  validate, 
  isSchema,
  ValidationError, 
  ValidationFailure, 
  SchemaError,
  SCHEMA_SYMBOL
} from './validator/index.js'

// Re-export is as default for convenient usage
export { default as is } from './validator/index.js'
