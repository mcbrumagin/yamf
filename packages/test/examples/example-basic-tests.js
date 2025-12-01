/**
 * Basic Test Examples - YAMF Test Library Usage
 * 
 * This file demonstrates the core testing utilities:
 * - assert() - Value and function assertions
 * - assertErr() - Error assertions
 * - Automatic async detection
 * - Multiple assertion functions
 * - Running tests without test suites
 * 
 * It is recommended to always export test functions
 *   for the CLI or other composite test entry files.
 * This also ensures portability if a test 
 *   function is moved between test files.
 */

import {
  assert,
  assertEach,
  assertSequence,
  assertErr,
  assertErrEach,
  assertErrSequence,
  runTests
} from '@yamf/test'

// ============================================================================
// Basic Assertion Examples
// ============================================================================

// Example 1: Assert on a direct value
export function testDirectValue() {
  assert(5, n => n > 0, n => n < 10)
}

// Example 2: Assert on a function result
export function testFunctionResult() {
  const getValue = () => 42
  assert(() => getValue(), n => n === 42)
}

// Example 3: Assert with anonymous arrow function
export const testArrowFunction = () => assert(true, b => b === true)

// Example 4: Assert with multiple conditions
export function testMultipleConditions() {
  const user = { name: 'Alice', age: 30, active: true }
  assert(user,
    u => u.name === 'Alice',
    u => u.age > 18,
    u => u.active === true
  )
}

// ============================================================================
// Async Assertion Examples (auto-detected)
// ============================================================================

// Example 5: Assert on a Promise
export async function testPromiseValue() {
  const promise = Promise.resolve(10)
  await assert(promise, n => n === 10)
}

// Example 6: Assert on async function
export async function testAsyncFunction() {
  const fetchData = async () => {
    await new Promise(resolve => setTimeout(resolve, 10))
    return { status: 'ok' }
  }
  
  await assert(
    async () => await fetchData(),
    result => result.status === 'ok'
  )
}

// Example 7: Assert on promise-returning function (not async)
export async function testPromiseReturningFunction() {
  const getData = () => Promise.resolve({ value: 42 })
  
  await assert(
    () => getData(), // Not async, but returns a Promise
    result => result.value === 42
  )
}

// ============================================================================
// Error Assertion Examples
// ============================================================================

// Example 8: Assert on a thrown error
export function testThrownError() {
  const throwError = () => {
    throw new Error('Expected error')
  }
  
  assertErr(
    () => throwError(),
    err => err.message === 'Expected error',
    err => err instanceof Error
  )
}

// Example 9: Assert on a direct Error object
export function testDirectError() {
  const error = new Error('Test error')
  assertErr(error, err => err.message === 'Test error')
}

// Example 10: Assert on async error
export async function testAsyncError() {
  const failingAsync = async () => {
    throw new Error('Async failure')
  }
  
  await assertErr(
    async () => await failingAsync(),
    err => err.message === 'Async failure'
  )
}

// Example 11: Assert on promise rejection
export async function testPromiseRejection() {
  const rejectingFn = () => Promise.reject(new Error('Rejected'))
  
  await assertErr(
    () => rejectingFn(),
    err => err.message === 'Rejected'
  )
}

// ============================================================================
// Array Assertion Examples - assertEach
// ============================================================================

// Example 12: Assert on each value in an array (all must pass all assertions)
export function testAssertEach() {
  const numbers = [1, 2, 3, 4, 5]
  assertEach(numbers,
    n => n > 0,
    n => n < 10
  )
}

// Example 13: Assert on each async value
export async function testAssertEachAsync() {
  const promises = [
    Promise.resolve({ status: 'ok', code: 200 }),
    Promise.resolve({ status: 'ok', code: 200 }),
    Promise.resolve({ status: 'ok', code: 200 })
  ]
  
  await assertEach(promises,
    r => r.status === 'ok',
    r => r.code === 200
  )
}

// ============================================================================
// Sequence Assertion Examples - assertSequence
// ============================================================================

// Example 14: Assert on each value with corresponding assertion
export function testAssertSequence() {
  const results = ['first', 'second', 'third']
  assertSequence(results,
    v => v === 'first',
    v => v === 'second',
    v => v === 'third'
  )
}

// Example 15: Assert on async sequence
export async function testAssertSequenceAsync() {
  const promises = [
    Promise.resolve(10),
    Promise.resolve(20),
    Promise.resolve(30)
  ]
  
  await assertSequence(promises,
    n => n === 10,
    n => n === 20,
    n => n === 30
  )
}

// ============================================================================
// Error Array Assertion Examples - assertErrEach
// ============================================================================

// Example 16: Assert on each error in an array
export function testAssertErrEach() {
  assertErrEach([
    new Error('Connection failed'),
    new Error('Timeout occurred'),
    new Error('Network error')
  ],
    err => err instanceof Error,
    err => err.message.length > 0
  )
}

// Example 17: Assert each function throws
export function testAssertErrEachFunctions() {
  assertErrEach([
    () => { throw new Error('error1') },
    () => { throw new Error('error2') },
    () => { throw new Error('error3') }
  ],
    err => err instanceof Error,
    err => err.message.includes('error')
  )
}

// Example 18: Assert each async function throws
export async function testAssertErrEachAsync() {
  await assertErrEach([
    async () => { throw new Error('async1') },
    async () => { throw new Error('async2') }
  ],
    err => err instanceof Error,
    err => err.message.includes('async')
  )
}

// ============================================================================
// Error Sequence Assertion Examples - assertErrSequence
// ============================================================================

// Example 19: Assert on each error with corresponding assertion
export function testAssertErrSequence() {
  assertErrSequence([
    new Error('First error'),
    new Error('Second error')
  ],
    err => err.message === 'First error',
    err => err.message === 'Second error'
  )
}

// Example 20: Assert each function throws with specific assertion
export function testAssertErrSequenceFunctions() {
  assertErrSequence([
    () => { throw new Error('Step 1 failed') },
    () => { throw new Error('Step 2 failed') },
    () => { throw new Error('Step 3 failed') }
  ],
    err => err.message.includes('Step 1'),
    err => err.message.includes('Step 2'),
    err => err.message.includes('Step 3')
  )
}

// Example 21: Assert each async function throws with specific assertion
export async function testAssertErrSequenceAsync() {
  await assertErrSequence([
    async () => { throw new Error('Phase 1 error') },
    async () => { throw new Error('Phase 2 error') }
  ],
    err => err.message.includes('Phase 1'),
    err => err.message.includes('Phase 2')
  )
}

// ============================================================================
// Examples of Test Failures (not exported, commented out below)
// ============================================================================

// Example 22: Single assertion failure
function testThisWillShowSingleFailure() {
  assert(5, n => n > 10) // Fails - shows the failing assertion function
}

// Example 23: Multiple assertion failures
function testThisWillShowMultipleFailures() {
  const user = { name: 'Alice', age: 15 }
  assert(user,
    u => u.name === 'Bob',    // Fails
    u => u.age > 18,          // Fails
    u => u.active === true    // Fails
  )
  // Shows all three failing assertion functions
}

// ============================================================================
// Run All Tests
// ============================================================================

// Collect all test functions
const tests = {
  testDirectValue,
  testFunctionResult,
  testArrowFunction,
  testMultipleConditions,
  testPromiseValue,
  testAsyncFunction,
  testPromiseReturningFunction,
  testThrownError,
  testDirectError,
  testAsyncError,
  testPromiseRejection,
  testAssertEach,
  testAssertEachAsync,
  testAssertSequence,
  testAssertSequenceAsync,
  testAssertErrEach,
  testAssertErrEachFunctions,
  testAssertErrEachAsync,
  testAssertErrSequence,
  testAssertErrSequenceFunctions,
  testAssertErrSequenceAsync,
  // testThisWillShowSingleFailure,
  // testThisWillShowMultipleFailures
}

// Run tests without using test suites
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests(tests)
    .then(() => process.exit(0))
    .catch(err => process.exit(err.code || 1))
}

/*
 * Key Takeaways:
 * 
 * 1. assert() and assertErr() automatically detect if async is needed
 * 2. Just add "await" when dealing with Promises or async functions
 * 3. Multiple assertion functions run simultaneously and all failures are reported
 * 4. Error messages show the exact assertion function(s) that failed
 * 5. Tests can run without test suites using runTests() directly
 * 6. Test functions should be named for clear test reporting
 * 7. Use assertEach when all values must pass the same assertions
 * 8. Use assertSequence when each value has a specific corresponding assertion
 * 9. Use assertErrEach when testing multiple errors with the same criteria
 * 10. Use assertErrSequence when each error has specific expected behavior
 */

