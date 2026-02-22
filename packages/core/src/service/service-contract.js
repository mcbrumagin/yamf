/**
 * Service Contract
 * Runtime contract extraction and validation for yamf services.
 * 
 * Contracts are opt-in via `useContract` on createService:
 *   false (default) - no contract
 *   true            - auto-extract from function signature, enforce on callers
 *   { params, expectedKeys, ... } - custom contract, enforce on callers
 */

import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-contract' })

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
 * Auto-extract a contract from a service function.
 */
export function extractContract(serviceFn) {
  const params = getParamNames(serviceFn)
  const hasRestParam = params.some(p => p.startsWith('...'))
  const hasDestructuring = params.some(p => p.startsWith('{') || p.startsWith('['))
  const expectedKeys = hasDestructuring ? extractDestructuredKeys(serviceFn) : []

  return {
    enforce: true,
    params,
    expectedKeys,
    hasRestParam,
    hasDestructuring,
    extractedAt: Date.now()
  }
}

/**
 * Build a contract from the useContract option.
 * @param {boolean|Object} useContract - false, true, or custom contract object
 * @param {Function} serviceFn - the service handler function
 * @returns {Object|null} contract or null
 */
export function buildContract(useContract, serviceFn) {
  if (!useContract) return null

  let contract
  if (useContract === true) {
    contract = extractContract(serviceFn)
  } else if (typeof useContract === 'object') {
    contract = {
      enforce: true,
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

/**
 * Validate a payload against a service contract.
 * Throws HttpError(400) on mismatch.
 * 
 * Currently only enforces expected key presence for destructured-param contracts.
 * Payload type enforcement (e.g. must be plain object) is deferred to static
 * contract analysis -- the framework legitimately supports non-object payloads.
 * 
 * @param {string} serviceName
 * @param {*} payload
 * @param {Object} contract
 */
export function validatePayloadAgainstContract(serviceName, payload, contract) {
  if (!contract?.enforce) return

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
