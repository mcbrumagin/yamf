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
  assertErr,
  runTests
} from '../core/index.js'

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
// Examples of Test Failures (commented out)
// ============================================================================

// Example 12: Single assertion failure
export function testThisWillShowSingleFailure() {
  assert(5, n => n > 10) // Fails - shows the failing assertion function
}

// Example 13: Multiple assertion failures
export function testThisWillShowMultipleFailures() {
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
  testThisWillShowSingleFailure,
  testThisWillShowMultipleFailures
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
 */

