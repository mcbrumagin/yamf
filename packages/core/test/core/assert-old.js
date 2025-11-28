import { Logger } from '../../src/index.js'

const logger = new Logger()

const getValOrErrString = (val) => {
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

    let targetMessageString = getValOrErrString(val)
    
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

    let targetMessageString = getValOrErrString(val)
    
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

/**
 * Assert that each value in an array passes all assertion functions
 * 
 * Automatically detects and handles async when needed.
 * Applies each assertion function to each value in the array.
 * 
 * @param {Array} values - Array of values to test
 * @param {...Function} assertFns - Assertion functions returning true/false
 * @returns {void|Promise<void>} - Throws AssertError or MultiAssertError on failure
 * 
 * @example
 * // Sync usage
 * assertEach([1, 2, 3], 
 *   n => n > 0,
 *   n => n < 10
 * )
 * 
 * // Async usage (auto-detected, just add await)
 * await assertEach([promise1, promise2], 
 *   val => val !== null,
 *   val => val.status === 'ok'
 * )
 */
export function assertEach(values, ...assertFns) {
  if (!Array.isArray(values)) {
    throw new Error('assertEach requires an array as the first argument')
  }

  // Check if any values are promises (need async)
  const hasPromises = values.some(v => v instanceof Promise)
  
  if (hasPromises) {
    // Async path - resolve all values first
    return Promise.all(values).then(resolvedValues => {
      const errors = []
      
      for (let i in resolvedValues) {
        const value = resolvedValues[i]
        for (const assertFn of assertFns) {
          const result = assertFn(value)
          if (result !== true) {
            errors.push(new Error(
              `  assertEach failed for value[${i}] (${JSON.stringify(value)})\n` +
              `  assertFn: ${assertFn.toString()}`
            ))
          }
        }
      }
      
      if (errors.length > 1) {
        throw new MultiAssertError(values, 'assertEach', errors)
      } else if (errors.length === 1) {
        throw new AssertError(values, 'assertEach', errors[0].message)
      }
    })
  } else {
    // Sync path
    const errors = []
    
    for (let i in values) {
      const value = values[i]
      for (const assertFn of assertFns) {
        const result = assertFn(value)
        if (result !== true) {
          errors.push(new Error(
            `  assertEach failed for value[${i}] (${JSON.stringify(value)})\n` +
            `  assertFn: ${assertFn.toString()}`
          ))
        }
      }
    }
    
    if (errors.length > 1) {
      throw new MultiAssertError(values, 'assertEach', errors)
    } else if (errors.length === 1) {
      throw new AssertError(values, 'assertEach', errors[0].message)
    }
  }
}

/**
 * Assert that each value in an array passes the corresponding assertion function
 * 
 * Automatically detects and handles async when needed.
 * Applies the corresponding assertion function to each value in the array.
 * Errors early if the number of values and assertion functions do not match.
 * 
 * @param {Array} values - Array of values to test
 * @param {...Function} assertFns - Assertion functions returning true/false
 * @returns {void|Promise<void>} - Throws AssertError or MultiAssertError on failure
 * 
 * @example
 * // Sync usage
 * assertSequence([1, 2, 3], 
 *   n => n === 1,
 *   n => n === 2,
 *   n => n === 3
 * )
 * 
 * // Async usage (auto-detected, just add await)
 * await assertSequence([promise1, promise2, promise3], 
 *   val => val !== null,
 *   val => val.status === 'ok',
 *   val => val.count > 0
 * )
 */
export function assertSequence(values, ...assertFns) {
  if (!Array.isArray(values)) {
    throw new Error('assertSequence requires an array as the first argument')
  }
  
  if (values.length !== assertFns.length) {
    throw new Error('assertSequence requires the same number of values and assertion functions')
  }

  // Check if any values are promises (need async)
  const hasPromises = values.some(v => v instanceof Promise)
  
  if (hasPromises) {
    // Async path - resolve all values first
    return Promise.all(values).then(resolvedValues => {
      const errors = []
      
      for (let i = 0; i < resolvedValues.length; i++) {
        const value = resolvedValues[i]
        const assertFn = assertFns[i]
        const result = assertFn(value)
        if (result !== true) {
          errors.push(new Error(
            `  assertSequence failed for value[${i}] (${JSON.stringify(value)})\n` +
            `  assertFn: ${assertFn.toString()}`
          ))
        }
      }
      
      if (errors.length > 1) {
        throw new MultiAssertError(values, 'assertSequence', errors)
      } else if (errors.length === 1) {
        throw new AssertError(values, 'assertSequence', errors[0].message)
      }
    })
  } else {
    // Sync path
    const errors = []
    
    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      const assertFn = assertFns[i]
      const result = assertFn(value)
      if (result !== true) {
        errors.push(new Error(
          `  assertSequence failed for value[${i}] (${JSON.stringify(value)})\n` +
          `  assertFn: ${assertFn.toString()}`
        ))
      }
    }
    
    if (errors.length > 1) {
      throw new MultiAssertError(values, 'assertSequence', errors)
    } else if (errors.length === 1) {
      throw new AssertError(values, 'assertSequence', errors[0].message)
    }
  }
}


async function validateErrThrowsAndProcessAssertions(errOrFn, ...assertFns) {
  let val
  if (errOrFn instanceof Promise) {
    await new Promise((resolve, reject) => {
      try {
        errOrFn.then(v => { val = v }).catch(e => { val = e }).finally(resolve)
      } catch (err) {
        reject(err)
      }
    })
  } else if (errOrFn.constructor.name === 'AsyncFunction') {
    try {
      val = await errOrFn()
    } catch (e) {
      val = e
    }
  } else if (typeof errOrFn === 'function') {
    val = errOrFn()
  }

  let assertionFailures = []
  if (val instanceof Error) {
    await Promise.all(assertFns.map(async assertFn => {
      try {
        let isValid = await assertFn(val)
        if (!isValid) {
          assertionFailures.push(new AssertError(val, 'assertErr',
            `  ErrAssertion failed for val = ${val} - assertErrFn: ${fn.toString()}`
          ))
        }
      } catch (assertionErr) {
        assertionFailures.push(assertionErr)
      }
    }))
  } else {
    // TODO message format
    assertionFailures.push(new AssertError(val, 'assertErr',
      `  ErrAssertion failed for val = ${val} - expected an error`
    ))
  }

  if (assertionFailures.length > 0) {
    let failureResult
    if (assertionFailures.length === 1) {
      failureResult = assertionFailures[0]
    } else {
      failureResult = new MultiAssertError(val, 'assertErr', assertionFailures)
    }
    return failure
  }
}

/**
 * Assert that each error in an array passes all assertion functions
 * Assert that each function in an array throws an error matching all assertion functions
 * 
 * Automatically detects and handles async when needed.
 * 
 * @param {Array} errsOrFns - Array of errors or functions that should throw
 * @param {...Function} assertFns - Assertion functions returning true/false
 * @returns {void|Promise<void>} - Throws AssertError or MultiAssertError on failure
 * 
 * @example
 * // Sync usage with error objects
 * assertErrEach([new Error('test'), new Error('test2')], 
 *   err => err instanceof Error,
 *   err => err.message.includes('test')
 * )
 * 
 * // Sync usage with throwing functions
 * assertErrEach([
 *   () => { throw new Error('error1') },
 *   () => { throw new Error('error2') }
 * ], 
 *   err => err instanceof Error,
 *   err => err.message.includes('error')
 * )
 * 
 * // Async usage (auto-detected, just add await)
 * await assertErrEach([
 *   async () => { throw new Error('async1') },
 *   async () => { throw new Error('async2') }
 * ], 
 *   err => err instanceof Error,
 *   err => err.message.includes('async')
 * )
 */
export async function assertErrEach(errsOrFns, ...assertFns) {
  let results = []
  for (let errOrFn of errsOrFns) {
    results.push(processErrorOrErrorFn(errOrFn, ...assertFns))
  }

  if (results.some(r => r instanceof AssertError)) {
    if (results.find(r => r instanceof AssertError) > 1) {
      throw new MultiAssertError()
    }

  }

  return results
}

export async function assertErrSequence() {
  // TODO
}
