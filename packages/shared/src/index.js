/**
 * @yamf/shared
 * 
 * Shared utilities for YAMF - truly isomorphic code that works in both browser and Node.js.
 */

import is from './validator/index.js'

// Default export is `is` for convenient usage
export default is

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

// Security/XSS exports
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
} from './validator/index.js'

// Also export individual encoding functions for direct use
export { encodeHtml, encodeAttr, unwrapTrusted } from './security/xss.js'

// Case mapping utilities
export {
  camelToSnake,
  snakeToCamel,
  toSnakeCase,
  toCamelCase,
  createColumnMapping,
  createFieldMapping
} from './utils/case-mapper.js'
