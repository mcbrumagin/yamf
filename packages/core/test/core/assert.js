import { Logger } from '../../src/index.js'

const logger = new Logger()

export class AssertError extends Error {

  constructor(val, assertType, assertFnMessage) {
    super() // Don't pass message to super yet
    this.val = val
    if (!assertFnMessage) {
      assertFnMessage = assertType
      assertType = 'assert'
    }
    this.assertType = assertType
    this.name = 'AssertError'

    const getValOrErrString = () => {
      if (val instanceof Error) {
        return `err = ${val.message}`
      } else {
        if (typeof val === 'object') {
          return JSON.stringify(val)
        } else {
          return `val = ${val}`
        }
      }
    }

    let targetMessageString = getValOrErrString()
    
    // Set both assertMessage (for compatibility) and message (for standard Error)
    this.assertMessage = this.name
      + `: "${assertType}" failed\n  for `
      + targetMessageString + '\n'
      + assertFnMessage
    
    // Set the standard message property
    this.message = this.assertMessage
  }
}

export class MultiAssertError extends Error {
  constructor(val, assertType, errors) {
    super() // Don't pass message to super yet
    this.val = val
    if (!errors) {
      errors = assertType
      assertType = 'assert'
    }
    this.assertType = assertType
    this.errors = errors
    this.name = 'MultiAssertError'

    const getValOrErrString = () => {
      if (val instanceof Error) {
        return `err = ${val.message}`
      } else {
        if (typeof val === 'object') {
          return JSON.stringify(val)
        } else {
          return `val = ${val}`
        }
      }
    }
    
    let targetMessageString = getValOrErrString()

    logger.warn('errors:', targetMessageString, errors.map(e => e.message))
    
    // Set both assertMessage (for compatibility) and message (for standard Error)
    this.assertMessage = this.name
      + `: "${assertType}" failed\n  for `
      + targetMessageString + '\n'
      + errors.map(e => e.message).join('\n')
    
    // Set the standard message property
    this.message = this.assertMessage
  }
}

/**
 * Core assertion function with automatic async detection
 * 
 * Automatically detects if async behavior is needed by checking:
 * - If valOrFn is a Promise
 * - If valOrFn is an AsyncFunction
 * - If the function returns a Promise (runtime check)
 * 
 * @param {*|Function|Promise} valOrFn - Value, function, or Promise to test
 * @param {Function[]} assertFns - Assertion functions that return true/false
 * @param {string} assertType - Type of assertion ('assert' or 'assertErr')
 * @returns {void|Promise<void>} - Throws AssertError or MultiAssertError on failure
 */
function assertCore(valOrFn, assertFns, assertType = 'assert') {
  // Check if we need async BEFORE evaluating the function
  const needsAsync = valOrFn instanceof Promise || 
                     (typeof valOrFn === 'function' && valOrFn.constructor.name === 'AsyncFunction')

  if (needsAsync) {
    // Async path
    let resultPromise
    if (typeof valOrFn === 'function') {
      resultPromise = valOrFn()
    } else {
      resultPromise = valOrFn
    }
    
    return resultPromise.then(result => {
      return runAssertions(result, assertFns, assertType, true)
    })
  } else {
    // Sync path
    let result
    if (typeof valOrFn === 'function') {
      result = valOrFn()
    } else {
      result = valOrFn
    }

    // help to maintain a promise chain even if it wasn't marked as async
    if (result instanceof Promise) {
      return result.then(result => {
        return runAssertions(result, assertFns, assertType, false)
      })
    } else return runAssertions(result, assertFns, assertType, false)
  }
}

/**
 * Run assertion functions against a result
 * @param {*} result - The resolved value to test
 * @param {Function[]} assertFns - Array of assertion functions
 * @param {string} assertType - Type of assertion for error messages
 * @param {boolean} isAsync - Whether to run assertions asynchronously
 */
function runAssertions(result, assertFns, assertType, isAsync) {
  const fnLabel = assertType === 'assert' ? 'assertFn' : 'assertErrFn'
  
  // Handle single assertion function
  if (assertFns.length === 1) {
    if (isAsync) {
      return Promise.resolve(assertFns[0](result)).then(assertResult => {
        if (assertResult != true) {
          throw new AssertError(result, assertType, `  ${fnLabel}: ${assertFns[0].toString()}`)
        }
      })
    } else {
      let assertResult = assertFns[0](result)
      if (assertResult != true) {
        throw new AssertError(result, assertType, `  ${fnLabel}: ${assertFns[0].toString()}`)
      }
      return
    }
  }

  // Handle multiple assertion functions
  if (isAsync) {
    return Promise.all(assertFns.map(async assertFn => {
      let assertResult = await assertFn(result)
      if (assertResult != true) {
        return new Error(`  ${fnLabel}: ${assertFn.toString()}`)
      }
    })).then(errors => {
      errors = errors.filter(e => e instanceof Error)
      if (errors.length > 1) throw new MultiAssertError(result, assertType, errors)
      else if (errors.length === 1) throw new AssertError(result, assertType, errors[0].message)
    })
  } else {
    let errors = assertFns.map(assertFn => {
      let assertResult = assertFn(result)
      if (assertResult != true) {
        return new Error(`  ${fnLabel}: ${assertFn.toString()}`)
      }
    })

    errors = errors.filter(e => e instanceof Error)
    if (errors.length > 1) throw new MultiAssertError(result, assertType, errors)
    else if (errors.length === 1) throw new AssertError(result, assertType, errors[0].message)
  }
}

/**
 * Assert that a value or function result passes all assertion functions
 * 
 * Automatically detects and handles async when needed:
 * - Direct Promise: `await assert(promise, fn)`
 * - Async function: `await assert(async () => await fetchData(), fn)`
 * - Promise-returning function: `await assert(() => fetchData(), fn)`
 * - Sync function: `assert(() => getValue(), fn)`
 * - Direct value: `assert(5, fn)`
 * 
 * @param {*|Function|Promise} valOrFn - Value, function, or Promise to test
 * @param {...Function} assertFns - Assertion functions returning true/false
 * @returns {void|Promise<void>} - Throws AssertError or MultiAssertError on failure
 * 
 * @example
 * // Sync usage
 * assert(5, n => n > 0)
 * assert(() => getValue(), n => n > 0)
 * 
 * // Async usage (auto-detected, just add await)
 * await assert(promise, v => v !== null)
 * await assert(async () => await fetchData(), d => d.status === 'ok')
 * await assert(() => fetchData(), d => d.status === 'ok') // Promise-returning
 */
export function assert(valOrFn, ...assertFns) {
  return assertCore(valOrFn, assertFns, 'assert')
}

/**
 * Assert that a function throws an error matching all assertion functions
 * 
 * Automatically detects and handles async when needed:
 * - Direct Error: `assertErr(error, fn)`
 * - Sync throwing function: `assertErr(() => throwingFn(), fn)`
 * - Async throwing function: `await assertErr(async () => await failingFn(), fn)`
 * - Promise-rejecting function: `await assertErr(() => rejectingFn(), fn)`
 * 
 * @param {Error|Function} errOrFn - Error object or function that should throw
 * @param {...Function} assertFns - Assertion functions returning true/false
 * @returns {void|Promise<void>} - Throws AssertError or MultiAssertError on failure
 * 
 * @example
 * // Sync usage
 * assertErr(() => throwingFn(), err => err.message.includes('expected'))
 * assertErr(new Error('test'), err => err.message === 'test')
 * 
 * // Async usage (auto-detected, just add await)
 * await assertErr(async () => await failingAsyncFn(), err => err.status === 400)
 * await assertErr(() => rejectingPromiseFn(), err => err.message === 'rejected')
 */
export function assertErr(errOrFn, ...assertFns) {
  // Handle direct Error object
  if (errOrFn instanceof Error) {
    return runAssertions(errOrFn, assertFns, 'assertErr', false)
  }

  // Handle function that should throw
  if (typeof errOrFn === 'function') {
    const isAsync = errOrFn.constructor.name === 'AsyncFunction'
    
    if (isAsync) {
      // Async error catching
      return errOrFn()
        .then(
          (val) => {
            throw new AssertError(val, 'assertErr', `Expected an error for fn: ${errOrFn}`)
          },
          (err) => {
            if (!(err instanceof Error)) {
              throw new AssertError(err, 'assertErr', `Expected an error for fn: ${errOrFn}`)
            }
            return runAssertions(err, assertFns, 'assertErr', true)
          }
        )
        .finally(() => {
          // Cleanup if needed
          if (errOrFn.terminate) return errOrFn.terminate()
        })
    } else {
      // Sync error catching
      let err
      let result
      try {
        result = errOrFn()
      } catch (e) {
        err = e
      } finally {
        if (errOrFn.terminate) errOrFn.terminate()
      }

      // TODO move or duplicate for promise check?
      const validateError = () => {
        if (!(err instanceof Error)) {
          let prettyPrintVal = logger.prettyPrint(err)
          let message = `Expected an error but received \nval: ${prettyPrintVal}`
          if (typeof errOrFn === 'function') message += `\n fn: ${errOrFn}`
          throw new AssertError(err, 'assertErr', message)
        }
      }

      // TODO verify and fix (needs catch)
      // help to maintain a promise chain even if it wasn't marked as async
      if (result instanceof Promise) {
        return result.catch(e => err = e).finally(() => {
          validateError()
          return runAssertions(err, assertFns, 'assertErr', false)
        })
      } else {
        validateError()
        return runAssertions(err, assertFns, 'assertErr', false)
      }
    }
  }

  throw new Error('assertErr requires an Error object or a function')
}
