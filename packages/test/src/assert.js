import {
  AssertionFailure,
  AssertionFailureDetail,
  MultiAssertionFailure,
} from './assertion-errors.js'

function isAsyncOrPromise(arg) {
  return arg instanceof Promise || arg?.constructor?.name === 'AsyncFunction'
}

// used to check what mode to run in
function scanAllArgumentsForAsyncOrPromise(args, assertFns) {
  if (!Array.isArray(args)) {
    if (isAsyncOrPromise(args)) return true
  } else {
    for (let arg of args) if (isAsyncOrPromise(arg)) return true
    for (let fn of assertFns) if (isAsyncOrPromise(fn)) return true
  }
  return false
}

// validator for sequence fns (expects a matching assertionFn length)
function validateSequenceAssertionCount(targets, assertFns) {
  if (!Array.isArray(targets) || !Array.isArray(assertFns))
    throw new Error('Expected sequence assertion arguments to be arrays')
  if (targets.length !== assertFns.length)
    throw new Error('Expected sequence assertion arguments to be the same length')
}

// for multi-assertion meta-helpers (each, sequence)
function checkFailuresAndThrowMultiAssertionFailure(assertionName, failures) {
  if (failures.length === 0) return
  if (failures.length > 1) {
    throw new MultiAssertionFailure(assertionName, failures)
  } else if (failures.length === 1) {
    throw failures[0]
  }
}

function distillValueFromTestArgument(val) {
  try {
    if (typeof val === 'function') val = val()
  } catch (err) {
    val = err
  }
  // if we find a promise, throw so we can attempt to run as async
  if (val instanceof Promise) {
    let err = new Error('Found Promise in Sync Fn')
    err.promise = val
    throw err
  }
  
  return val
}

async function distillValueFromTestArgumentAsync(val) {
  try {
    if (typeof val === 'function') {
      val = await val()
    } else if (val instanceof Promise) {
      return val.then(a => val = a).catch(e => val = e)
    }
  } catch (err) {
    val = err
  }
  return val
}


function getAssertionFailuresForValue(val, ...assertFns) {
  let assertionFailures = []
  if (!(val instanceof Error)) {
    let failedAssertFns = []
    assertFns.forEach(assertFn => {
      try {
        let isValid
        if (typeof assertFn === 'function') {
          isValid = assertFn(val)
        } else {
          isValid = val === assertFn
        }
        if (!isValid) {
          failedAssertFns.push(assertFn)
        }
      } catch (assertionErr) {
        failedAssertFns.push(assertionErr)
      }
    })
    if (failedAssertFns.length > 0) {
      assertionFailures.push(new AssertionFailureDetail(val, failedAssertFns))
    }
  } else {
    assertionFailures.push(new AssertionFailureDetail(val, 'expected no error'))
  }
  return assertionFailures
}

async function getAssertionFailuresForValueAsync(val, ...assertFns) {
  let assertionFailures = []
  if (!(val instanceof Error)) {
    let failedAssertFns = []
    await Promise.all(assertFns.map(async assertFn => {
      try {
        let isValid
        if (typeof assertFn === 'function') {
          isValid = await assertFn(val)
        } else {
          isValid = val === assertFn
        }
        if (!isValid) {
          failedAssertFns.push(assertFn)
        }
      } catch (assertionErr) {
        failedAssertFns.push(assertionErr)
      }
    }))
    if (failedAssertFns.length > 0) {
      assertionFailures.push(new AssertionFailureDetail(val, failedAssertFns))
    }
  } else {
    assertionFailures.push(new AssertionFailureDetail(val, 'expected no error'))
  }
  return assertionFailures
}

function getErrorAssertionFailuresForValue(val, ...assertFns) {
  let assertionFailures = []
  if (val instanceof Error) {
    let failedAssertFns = []
    assertFns.forEach(assertFn => {
      try {
        let isValid = assertFn(val)
        if (!isValid) {
          failedAssertFns.push(assertFn)
        }
      } catch (assertionErr) {
        failedAssertFns.push(assertionErr)
      }
    })
    if (failedAssertFns.length > 0) {
      assertionFailures.push(new AssertionFailureDetail(val, failedAssertFns))
    }
  } else {
    assertionFailures.push(new AssertionFailureDetail(val, 'expected an error'))
  }
  return assertionFailures
}

async function getErrorAssertionFailuresForValueAsync(val, ...assertFns) {
  let assertionFailures = []
  if (val instanceof Error) {
    let failedAssertFns = []
    await Promise.all(assertFns.map(async assertFn => {
      try {
        let isValid = await assertFn(val)
        if (!isValid) {
          failedAssertFns.push(assertFn)
        }
      } catch (assertionErr) {
        failedAssertFns.push(assertionErr)
      }
    }))
    if (failedAssertFns.length > 0) {
      assertionFailures.push(new AssertionFailureDetail(val, failedAssertFns))
    }
  } else {
    assertionFailures.push(new AssertionFailureDetail(val, 'expected an error'))
  }
  return assertionFailures
}

function getTransformedAssertionFailuresforValue(val, ...assertFns) {
  let assertionFailures = getAssertionFailuresForValue(val, ...assertFns)
  let failure = checkAndTransformErrorsToMultiAssertError(val, assertionFailures)
  return failure
}

async function getTransformedAssertionFailuresforValueAsync(val, ...assertFns) {
  let assertionFailures = await getAssertionFailuresForValueAsync(val, ...assertFns)
  let failure = checkAndTransformErrorsToMultiAssertError(val, assertionFailures)
  return failure
}

function getTransformedErrorAssertionFailuresforValue(val, ...assertFns) {
  let assertionFailures = getErrorAssertionFailuresForValue(val, ...assertFns)
  let failure = checkAndTransformErrorsToMultiAssertError(val, assertionFailures)
  return failure
}

async function getTransformedErrorAssertionFailuresforValueAsync(val, ...assertFns) {
  let assertionFailures = await getErrorAssertionFailuresForValueAsync(val, ...assertFns)
  let failure = checkAndTransformErrorsToMultiAssertError(val, assertionFailures)
  return failure
}

function checkAndTransformErrorsToMultiAssertError(val, assertionFailures) {
  if (Array.isArray(assertionFailures) && assertionFailures.length > 0) {
    let failure
    if (assertionFailures.length === 1) {
      failure = new AssertionFailure(val, assertionFailures[0])
    } else {
      failure = new AssertionFailure(val, assertionFailures)
    }
    return failure
  }
}

// main assertion helper entry-point
function processAssertionAndChooseSyncOrAsyncPath(assertionHelper, target, ...assertFns) {
  const doAsyncPath = (thrownPromise) => new Promise((resolve, reject) => assertionHelper
    // use the val from the (sync) thrown promise target
    .async(thrownPromise || target, ...assertFns)
    .catch(reject)
    .finally(resolve)
  )
  if (scanAllArgumentsForAsyncOrPromise(target, assertFns)) {
    return doAsyncPath()
  } else try {
    return assertionHelper.sync(target, ...assertFns)
  } catch (err) {
    if (err.message?.includes('Found Promise')) {
      return doAsyncPath(err.promise)
    } else throw err
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
  return processAssertionAndChooseSyncOrAsyncPath(assert, valOrFn, ...assertFns)
}

assert.sync = function assertSync(valOrFn, ...assertFns) {
  let val = distillValueFromTestArgument(valOrFn)
  let failure = getTransformedAssertionFailuresforValue(val, ...assertFns)
  if (failure) throw failure
}

assert.async = async function assertAsync(valOrFn, ...assertFns) {
  let val = await distillValueFromTestArgumentAsync(valOrFn)
  let failure = await getTransformedAssertionFailuresforValueAsync(val, ...assertFns)
  if (failure) throw failure
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
  return processAssertionAndChooseSyncOrAsyncPath(assertErr, errOrFn, ...assertFns)
}

assertErr.sync = function assertErrSync(errOrFn, ...assertFns) {
  let val = distillValueFromTestArgument(errOrFn)
  let failure = getTransformedErrorAssertionFailuresforValue(val, ...assertFns)
  if (failure) throw failure
}

assertErr.async = async function assertErrAsync(errOrFn, ...assertFns) {
  let val = await distillValueFromTestArgumentAsync(errOrFn)
  let failure = await getTransformedErrorAssertionFailuresforValueAsync(val, ...assertFns)
  if (failure) throw failure
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
  return processAssertionAndChooseSyncOrAsyncPath(assertEach, values, ...assertFns)
}

assertEach.sync = function assertEachSync(values, ...assertFns) {
  let failures = []
  for (let val of values) {
    val = distillValueFromTestArgument(val)
    let failure = getTransformedAssertionFailuresforValue(val, ...assertFns)
    if (failure) failures.push(failure)
  }
  checkFailuresAndThrowMultiAssertionFailure('assertEachSync', failures)
}

assertEach.async = async function assertEachAsync(values, ...assertFns) {
  let failures = []
  for (let val of values) {
    val = await distillValueFromTestArgumentAsync(val)
    let failure = await getTransformedAssertionFailuresforValueAsync(val, ...assertFns)
    if (failure) failures.push(failure)
  }
  checkFailuresAndThrowMultiAssertionFailure('assertEachAsync', failures)
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
  validateSequenceAssertionCount(values, assertFns)
  return processAssertionAndChooseSyncOrAsyncPath(assertSequence, values, ...assertFns)
}

assertSequence.sync = function assertSequenceSync(values, ...assertFns) {
  let failures = []
  let index = 0
  for (let val of values) {
    val = distillValueFromTestArgument(val)
    let failure = getTransformedAssertionFailuresforValue(val, assertFns[index])
    if (failure) failures.push(failure)
    index++
  }
  checkFailuresAndThrowMultiAssertionFailure('assertSequenceSync', failures)
}

assertSequence.async = async function assertSequenceAsync(values, ...assertFns) {
  let failures = []
  let index = 0
  for (let val of values) {
    val = await distillValueFromTestArgumentAsync(val)
    let failure = await getTransformedAssertionFailuresforValueAsync(val, assertFns[index])
    if (failure) failures.push(failure)
    index++
  }
  checkFailuresAndThrowMultiAssertionFailure('assertSequenceAsync', failures)
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
export function assertErrEach(errsOrFns, ...assertFns) {
  return processAssertionAndChooseSyncOrAsyncPath(assertErrEach, errsOrFns, ...assertFns)
}

assertErrEach.sync = function assertErrEachSync(errsOrFns, ...assertFns) {
  let failures = []
  for (let errOrFn of errsOrFns) {
    let val = distillValueFromTestArgument(errOrFn)
    let failure = getTransformedErrorAssertionFailuresforValue(val, ...assertFns)
    if (failure) failures.push(failure)
  }
  checkFailuresAndThrowMultiAssertionFailure('assertErrEachSync', failures)
}

assertErrEach.async = async function assertErrEachAsync(errsOrFns, ...assertFns) {
  let failures = []
  for (let errOrFn of errsOrFns) {
    let val = await distillValueFromTestArgumentAsync(errOrFn)
    let failure = await getTransformedErrorAssertionFailuresforValueAsync(val, ...assertFns)
    if (failure) failures.push(failure)
  }
  checkFailuresAndThrowMultiAssertionFailure('assertErrEachAsync', failures)
}


/* TODO documentation comment
*/
export function assertErrSequence(errsOrFns, ...assertFns) {
  validateSequenceAssertionCount(errsOrFns, assertFns)
  return processAssertionAndChooseSyncOrAsyncPath(assertErrSequence, errsOrFns, ...assertFns)
}

assertErrSequence.sync = function assertErrSequenceSync(errsOrFns, ...assertFns) {
  let failures = []
  let index = 0
  for (let errOrFn of errsOrFns) {
    let val = distillValueFromTestArgument(errOrFn)
    let failure = getTransformedErrorAssertionFailuresforValue(val, assertFns[index])
    if (failure) failures.push(failure)
    index++
  }
  checkFailuresAndThrowMultiAssertionFailure('assertErrSequenceSync', failures)
}

assertErrSequence.async = async function assertErrSequenceAsync(errsOrFns, ...assertFns) {
  let failures = []
  let index = 0
  for (let errOrFn of errsOrFns) {
    let val = await distillValueFromTestArgumentAsync(errOrFn)
    let failure = await getTransformedErrorAssertionFailuresforValueAsync(val, assertFns[index])
    if (failure) failures.push(failure)
    index++
  }
  checkFailuresAndThrowMultiAssertionFailure('assertErrSequenceAsync', failures)
}
