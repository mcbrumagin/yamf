# @yamf/test

A minimal, zero-dependency testing library with polymorphic async/await and simultaneous assertion reports.

[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## Features

✨ **Zero Dependencies** - Pure Node.js implementation  
🔄 **Automatic Async Detection** - Just add `await` when needed  
📊 **Multi-Assertion Reports** - All failures reported simultaneously  
🏃 **Sequential Test Execution** - Predictable, ordered test runs  
🎯 **Solo/Mute Flags** - Focus on specific tests or skip others  
📦 **Suite Support** - Organize tests into logical groups  
🎨 **Colorized Output** - Clear pass/fail visualization  

## Installation

```sh
npm install @yamf/test
```

## Quick Start

```javascript
import { assert, runTests } from '@yamf/test'

function testAddition() {
  assert(2 + 2, n => n === 4)
}

async function testAsyncFetch() {
  await assert(
    async () => await fetchData(),
    data => data.status === 'ok'
  )
}

runTests({ testAddition, testAsyncFetch })
```

## Core Assertions

### `assert(value, ...assertFns)`

Assert that a value or function result passes all assertion functions.

```javascript
// Direct value
assert(5, n => n > 0, n => n < 10)

// Function result
assert(() => getValue(), n => n === 42)

// Multiple conditions
const user = { name: 'Alice', age: 30 }
assert(user,
  u => u.name === 'Alice',
  u => u.age > 18
)

// Async (auto-detected - just add await)
await assert(Promise.resolve(10), n => n === 10)
await assert(async () => await fetchData(), d => d.status === 'ok')
await assert(() => fetchData(), d => d.status === 'ok') // Promise-returning
```

### `assertErr(error, ...assertFns)`

Assert that a function throws an error matching all assertion functions.

```javascript
// Direct error
assertErr(new Error('test'), err => err.message === 'test')

// Throwing function
assertErr(
  () => { throw new Error('expected') },
  err => err.message === 'expected',
  err => err instanceof Error
)

// Async throwing (auto-detected)
await assertErr(
  async () => { throw new Error('async failure') },
  err => err.message === 'async failure'
)

// Promise rejection
await assertErr(
  () => Promise.reject(new Error('rejected')),
  err => err.message === 'rejected'
)
```

## Array Assertions

### `assertEach(values, ...assertFns)`

Assert that **each value** in an array passes **all** assertion functions.

```javascript
// All values must pass all assertions
assertEach([1, 2, 3, 4, 5],
  n => n > 0,
  n => n < 10
)

// Async values
await assertEach([promise1, promise2, promise3],
  r => r.status === 'ok',
  r => r.code === 200
)
```

### `assertSequence(values, ...assertFns)`

Assert that **each value** passes its **corresponding** assertion function.

```javascript
// 1:1 mapping of values to assertions
assertSequence(['first', 'second', 'third'],
  v => v === 'first',
  v => v === 'second',
  v => v === 'third'
)

// Async sequence
await assertSequence([promise1, promise2, promise3],
  n => n === 10,
  n => n === 20,
  n => n === 30
)
```

### `assertErrEach(errors, ...assertFns)`

Assert that **each error** in an array passes **all** assertion functions.

```javascript
// Error objects
assertErrEach([
  new Error('Connection failed'),
  new Error('Timeout occurred')
],
  err => err instanceof Error,
  err => err.message.length > 0
)

// Throwing functions
assertErrEach([
  () => { throw new Error('error1') },
  () => { throw new Error('error2') }
],
  err => err instanceof Error,
  err => err.message.includes('error')
)
```

### `assertErrSequence(errors, ...assertFns)`

Assert that **each error** passes its **corresponding** assertion function.

```javascript
assertErrSequence([
  () => { throw new Error('Step 1 failed') },
  () => { throw new Error('Step 2 failed') }
],
  err => err.message.includes('Step 1'),
  err => err.message.includes('Step 2')
)
```

## Test Runners

### `runTests(tests)`

Run tests directly without organizing into suites.

```javascript
import { runTests } from '@yamf/test'

const tests = {
  testOne() { assert(1, n => n === 1) },
  testTwo() { assert(2, n => n === 2) }
}

runTests(tests)
  .then(() => process.exit(0))
  .catch(err => process.exit(err.code || 1))
```

### `TestRunner` Class

Organize tests into suites for better organization.

```javascript
import { TestRunner } from '@yamf/test'

const runner = new TestRunner()

// Add individual suite
runner.addSuite('math', {
  testAddition() { assert(2 + 2, n => n === 4) },
  testSubtraction() { assert(5 - 3, n => n === 2) }
})

// Add multiple suites
runner.addSuites({
  strings: {
    testConcat() { assert('a' + 'b', s => s === 'ab') }
  },
  arrays: {
    testPush() {
      const arr = [1, 2]
      arr.push(3)
      assert(arr.length, n => n === 3)
    }
  }
})

runner.run()
```

## Test Helpers

### `sleep(ms)`

Simple promise-based delay.

```javascript
import { sleep } from '@yamf/test'

async function testWithDelay() {
  await sleep(100) // Wait 100ms
  assert(true, v => v === true)
}
```

### `terminateAfter(...servers, testFn)`

Run tests with automatic server cleanup. Terminates all servers after the test completes (success or failure).

```javascript
import { terminateAfter } from '@yamf/test'
import { registryServer, createService } from '@yamf/core'

async function testServices() {
  await terminateAfter(
    registryServer(),
    createService(function myService(p) { return { ok: true } }),
    async (registry, service) => {
      const result = await callService('myService', {})
      assert(result.ok, v => v === true)
    }
  )
}
```

### `withEnv(envVars, testFn)`

Run a test with temporary environment variables that are restored after.

```javascript
import { withEnv } from '@yamf/test'

async function testWithEnv() {
  await withEnv(
    { NODE_ENV: 'test', API_KEY: 'secret' },
    async () => {
      assert(process.env.NODE_ENV, v => v === 'test')
      assert(process.env.API_KEY, v => v === 'secret')
    }
  )
  // Original env vars restored here
}
```

## Solo and Mute Flags

Focus on specific tests or skip others during development.

```javascript
function testNormal() {
  assert(1, n => n === 1)
}

// Only run this test (and others marked solo)
function testFocused() {
  assert(2, n => n === 2)
}
testFocused.solo = true

// Skip this test
function testSkipped() {
  assert(3, n => n === 3)
}
testSkipped.mute = true

runTests({ testNormal, testFocused, testSkipped })
// Only testFocused will run
```

## Error Types

### `AssertionFailure`

Thrown when an assertion fails with details about the failure.

### `MultiAssertionFailure`

Thrown when multiple assertions fail in a single test, containing all failure details.

## Best Practices

### Name Test Functions

Named functions provide clear test output:

```javascript
// Good - clear output: "✔ testUserValidation"
function testUserValidation() {
  assert(user.isValid, v => v === true)
}

// Avoid - unclear output
const test1 = () => assert(user.isValid, v => v === true)
```

### Export Test Functions

Export tests for CLI usage and composability:

```javascript
// user-tests.js
export function testUserCreation() { /* ... */ }
export function testUserDeletion() { /* ... */ }

// run-all.js
import * as userTests from './user-tests.js'
import * as authTests from './auth-tests.js'

runTests({ ...userTests, ...authTests })
```

### Use TODO for Pending Tests

Mark incomplete tests with TODO in the name:

```javascript
function TODOtestNewFeature() {
  throw new Error('TODO: implement this test')
}
// Test will be counted but not run
```

## Example Output

```
✔ testDirectValue (1ms)
✔ testFunctionResult (0ms)
✔ testAsyncFunction (15ms)
✘ testFailingAssertion

----- Testing Complete -----
✔ ✔ ✔  Success Report  ✔ ✔ ✔

  testDirectValue
  testFunctionResult
  testAsyncFunction

✘ ✘ ✘  Failure Report  ✘ ✘ ✘

  testFailingAssertion

testFailingAssertion failed with error: AssertionFailure: ...

----- Test Overview -----
ℹ tests 4
ℹ pass 3
ℹ fail 1
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 42
```

## API Reference

### Assertions

| Function | Description |
|----------|-------------|
| `assert(value, ...fns)` | Assert value passes all assertion functions |
| `assertErr(error, ...fns)` | Assert error matches all assertion functions |
| `assertEach(values, ...fns)` | Assert each value passes all assertions |
| `assertSequence(values, ...fns)` | Assert each value passes corresponding assertion |
| `assertErrEach(errors, ...fns)` | Assert each error passes all assertions |
| `assertErrSequence(errors, ...fns)` | Assert each error passes corresponding assertion |

### Runners

| Function | Description |
|----------|-------------|
| `runTests(tests)` | Run tests directly |
| `TestRunner` | Class for organizing tests into suites |
| `runTestFnsSequentially(fns)` | Low-level sequential test execution |
| `mergeAllTestsSafely(...tests)` | Merge test objects with duplicate detection |

### Helpers

| Function | Description |
|----------|-------------|
| `sleep(ms)` | Promise-based delay |
| `terminateAfter(...servers, fn)` | Run test with server cleanup |
| `withEnv(vars, fn)` | Run test with temporary env vars |

### Error Types

| Type | Description |
|------|-------------|
| `AssertionFailure` | Single assertion failure |
| `AssertionFailureDetail` | Detailed failure information |
| `MultiAssertionFailure` | Multiple assertion failures |

## License

MIT
