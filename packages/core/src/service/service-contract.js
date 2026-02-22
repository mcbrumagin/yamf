/**
 * Service Contract
 * Runtime contract extraction and validation for yamf services.
 * 
 * Contracts are opt-in via `useContract` on createService:
 *   false (default) - no contract
 *   true            - auto-extract from function signature, enforce on callers
 *   { params, expectedKeys, ... } - custom contract object, enforce on callers
 *   validatorFn     - a @yamf/shared createValidator() result, extracts schema
 *   schemaObj       - a raw validator schema object, extracts schema
 */

import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-contract' })

const YAMF_SCHEMA_SYMBOL = Symbol.for('yamf.validator.schema')

// Lazily cached reference to @yamf/shared/validator's validate function
let _validateFn = null
let _validateAttempted = false

async function getValidateFn() {
  if (_validateAttempted) return _validateFn
  _validateAttempted = true
  try {
    const mod = await import('@yamf/shared/validator')
    _validateFn = mod.validate
    logger.debug('Loaded @yamf/shared/validator for contract enforcement')
  } catch {
    _validateFn = null
    logger.debug('@yamf/shared/validator not available, validator contracts will fall back to key checking')
  }
  return _validateFn
}

// =============================================================================
// Param extraction (signature-based contracts)
// =============================================================================

/**
 * Extract parameter names from a function signature.
 * Handles regular functions, async functions, and arrow functions.
 */
export function getParamNames(func) {
  const fnStr = func.toString()
  const arrowMatch = fnStr.match(/^\s*(?:async\s+)?\(([^)]*)\)\s*=>/)
  const funcMatch = fnStr.match(/^\s*(?:async\s+)?function\s*\w*\s*\(([^)]*)\)/)
  const paramStr = (arrowMatch && arrowMatch[1]) || (funcMatch && funcMatch[1]) || ''

  return paramStr
    .split(',')
    .map(p => p.trim().split('=')[0].trim())
    .filter(p => p !== '')
}

/**
 * Extract destructured key names from the first parameter.
 * If the first param is `{ a, b, c }`, returns ['a', 'b', 'c'].
 */
export function extractDestructuredKeys(func) {
  const fnStr = func.toString()
  const match = fnStr.match(/^\s*(?:async\s+)?function\s*\w*\s*\(\s*\{([^}]*)\}/)
    || fnStr.match(/^\s*(?:async\s+)?\(\s*\{([^}]*)\}\s*(?:,|\))/)
  if (!match) return []

  return match[1]
    .split(',')
    .map(k => k.trim().split('=')[0].split(':')[0].trim())
    .filter(k => k !== '' && !k.startsWith('...'))
}

/**
 * Auto-extract a contract from a service function signature.
 */
export function extractContract(serviceFn) {
  const params = getParamNames(serviceFn)
  const hasRestParam = params.some(p => p.startsWith('...'))
  const hasDestructuring = params.some(p => p.startsWith('{') || p.startsWith('['))
  const expectedKeys = hasDestructuring ? extractDestructuredKeys(serviceFn) : []

  return {
    enforce: true,
    contractType: 'signature',
    params,
    expectedKeys,
    hasRestParam,
    hasDestructuring,
    extractedAt: Date.now()
  }
}

// =============================================================================
// Schema serialization for wire transport
// =============================================================================

/**
 * Serialize a validator schema for JSON transport.
 * Handles: Symbols, RegExp, nested schemas. Drops functions (custom validators, refinements).
 */
export function serializeSchema(schema) {
  if (schema === null || schema === undefined) return schema
  if (typeof schema === 'function') return undefined
  if (typeof schema === 'symbol') return undefined
  if (schema instanceof RegExp) return { _regex: true, source: schema.source, flags: schema.flags }
  if (typeof schema !== 'object') return schema

  if (Array.isArray(schema)) {
    return schema.map(serializeSchema).filter(v => v !== undefined)
  }

  const result = {}
  if (schema[YAMF_SCHEMA_SYMBOL]) result._yamfSchema = true

  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === 'function') continue
    const serialized = serializeSchema(value)
    if (serialized !== undefined) result[key] = serialized
  }

  return result
}

/**
 * Deserialize a schema from JSON transport back into a validator-compatible schema.
 * Restores Symbol.for('yamf.validator.schema') markers.
 */
export function deserializeSchema(data) {
  if (data === null || data === undefined) return data
  if (typeof data !== 'object') return data

  if (Array.isArray(data)) return data.map(deserializeSchema)

  // Restore RegExp
  if (data._regex && data.source) {
    return new RegExp(data.source, data.flags || '')
  }

  const result = {}
  if (data._yamfSchema) {
    result[YAMF_SCHEMA_SYMBOL] = true
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === '_yamfSchema') continue
    result[key] = deserializeSchema(value)
  }

  return result
}

/**
 * Extract top-level expected keys from a validator schema.
 */
function extractSchemaKeys(schema) {
  if (!schema || typeof schema !== 'object') return []

  // Single schema object (e.g. is.object({ ... }))
  if (schema[YAMF_SCHEMA_SYMBOL]) {
    if (schema.type === 'object' && schema.properties) {
      return Object.keys(schema.properties).filter(k =>
        !schema.properties[k]?.optional
      )
    }
    return []
  }

  // Plain object property map -- keys whose schemas are not optional
  return Object.keys(schema).filter(k => {
    const fieldSchema = schema[k]
    return fieldSchema && typeof fieldSchema === 'object' && !fieldSchema.optional
  })
}

// =============================================================================
// Validator detection
// =============================================================================

/**
 * Check if a value is a createValidator() result (function with .schema)
 */
function isValidatorFunction(val) {
  return typeof val === 'function' && val.schema && typeof val.validate === 'function'
}

/**
 * Check if a value looks like a validator schema object (has SCHEMA_SYMBOL or
 * is a plain object whose values have SCHEMA_SYMBOL).
 */
function isValidatorSchema(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false
  if (val[YAMF_SCHEMA_SYMBOL]) return true
  return Object.values(val).some(v =>
    v && typeof v === 'object' && v[YAMF_SCHEMA_SYMBOL]
  )
}

/**
 * Build a contract from a validator function or schema.
 */
function buildValidatorContract(validatorOrSchema) {
  const schema = validatorOrSchema.schema || validatorOrSchema
  const schemaName = validatorOrSchema.schemaName || null

  const serialized = serializeSchema(schema)
  const expectedKeys = extractSchemaKeys(schema)

  return {
    enforce: true,
    contractType: 'validator',
    validatorSchema: serialized,
    schemaName,
    expectedKeys,
    params: [],
    hasRestParam: false,
    hasDestructuring: false,
    extractedAt: Date.now()
  }
}

// =============================================================================
// Build contract (entry point)
// =============================================================================

/**
 * Build a contract from the useContract option.
 * 
 * @param {boolean|Object|Function} useContract
 *   false       - no contract
 *   true        - auto-extract from function signature
 *   validatorFn - createValidator() result, extracts schema
 *   schemaObj   - raw validator schema, extracts schema
 *   { params, expectedKeys, ... } - custom contract object
 * @param {Function} serviceFn - the service handler function
 * @returns {Object|null} contract or null
 */
export function buildContract(useContract, serviceFn) {
  if (!useContract) return null

  // Validator function (createValidator() result)
  if (isValidatorFunction(useContract)) {
    logger.info('Building validator contract from createValidator() result')
    return buildValidatorContract(useContract)
  }

  // Raw validator schema object
  if (typeof useContract === 'object' && isValidatorSchema(useContract)) {
    logger.info('Building validator contract from schema object')
    return buildValidatorContract(useContract)
  }

  let contract
  if (useContract === true) {
    contract = extractContract(serviceFn)
  } else if (typeof useContract === 'object') {
    contract = {
      enforce: true,
      contractType: 'custom',
      params: useContract.params || [],
      expectedKeys: useContract.expectedKeys || useContract.params || [],
      hasRestParam: false,
      hasDestructuring: false,
      extractedAt: Date.now(),
      ...useContract,
      enforce: true
    }
  } else {
    return null
  }

  if (contract.hasRestParam) {
    logger.warn('Service contract has rest parameters (...args) which make contracts unreliable')
  }

  return contract
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a payload against a service contract.
 * Throws HttpError(400) on mismatch.
 * 
 * For validator contracts: uses @yamf/shared/validator's validate() if available,
 * otherwise falls back to key checking.
 * For signature/custom contracts: checks expected key presence.
 * 
 * @param {string} serviceName
 * @param {*} payload
 * @param {Object} contract
 */
export async function validatePayloadAgainstContract(serviceName, payload, contract) {
  if (!contract?.enforce) return

  // Validator-based contract: use the full validator engine if available
  if (contract.contractType === 'validator' && contract.validatorSchema) {
    const validateFn = await getValidateFn()
    if (validateFn) {
      const schema = deserializeSchema(contract.validatorSchema)
      const result = validateFn(payload, schema)
      if (!result.valid) {
        const msgs = result.failures
          .map(f => f.path ? `${f.path}: ${f.message}` : f.message)
          .join('; ')
        throw new HttpError(400,
          `Contract violation for "${serviceName}": ${msgs}`
        )
      }
      return
    }
    // Fall through to key checking if validator not available
  }

  // Key-based validation (signature and custom contracts, or validator fallback)
  if (contract.expectedKeys && contract.expectedKeys.length > 0) {
    if (payload === null || payload === undefined || typeof payload !== 'object' || Array.isArray(payload)) {
      const got = payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload
      throw new HttpError(400,
        `Contract violation for "${serviceName}": payload must be a plain object when service expects destructured keys, got ${got}`
      )
    }

    const missing = contract.expectedKeys.filter(key => !(key in payload))
    if (missing.length > 0) {
      throw new HttpError(400,
        `Contract violation for "${serviceName}": missing required keys: ${missing.join(', ')}`
      )
    }
  }
}
