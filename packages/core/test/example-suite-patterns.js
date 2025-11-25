/**
 * Advanced Test Suite Patterns for YAMF Contributors
 * 
 * This file demonstrates:
 * - Using TestRunner to organize test suites
 * - Named exports from test case files (import *)
 * - Solo and mute flags for focused testing
 * - Suite-level organization and metadata
 * - Best practices for test organization
 */

import {
  assert,
  assertOn,
  assertErr,
  assertErrOn,
  sleep,
  terminateAfter,
  TestRunner
} from './core/index.js'

import {
  registryServer,
  createRoute,
  createService,
  callService,
  HttpError,
  Logger
} from '../src/index.js'

// Import entire test case files using import *
import * as cryptoTests from './cases/crypto-tests.js'
import * as edgeCaseTests from './cases/edge-case-tests.js'

const logger = new Logger({ includeLogLineNumbers: false })

// =============================================================================
// Example 1: Organizing Tests by Feature
// =============================================================================

export async function testBasicServiceCreation() {
  await terminateAfter(
    await registryServer(),
    await createService('example', () => ({ status: 'ok' })),
    async () => {
      const result = await callService('example', {})
      assert(result, r => r.status === 'ok')
    }
  )
}

export async function testServiceWithDependency() {
  await terminateAfter(
    await registryServer(),
    await createService('dependency', () => 'dep-result'),
    await createService('main', async function(payload) {
      return await this.call('dependency', payload) + '-main-result'
    }),
    async () => {
      const result = await callService('main', {})
      assert(result,
        r => r.includes('dep-result'),
        r => r.includes('main-result')
      )
    }
  )
}

export async function testServiceErrorHandling() {
  await terminateAfter(
    await registryServer(),
    await createService('thrower', () => {
      throw new HttpError(400, 'Intentional error')
    }),
    async () => {
      await assertErrOn(
        () => callService('thrower', {}),
        err => err.status === 400,
        err => err.message.includes('Intentional')
      )
    }
  )
}

// =============================================================================
// Example 2: Route Testing Patterns
// =============================================================================

export async function testRouteWithMethod() {
  await terminateAfter(
    registryServer(),
    createRoute('/api/echo', async function(payload, request) {
      return {
        method: request.method,
        receivedPayload: payload
      }
    }),
    async () => {
      const response = await fetch(
        `${process.env.MICRO_REGISTRY_URL}/api/echo`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ test: 'data' })
        }
      )
      const result = await response.json()
      
      assert(result,
        r => r.method === 'POST',
        r => r.receivedPayload && r.receivedPayload.test === 'data'
      )
    }
  )
}

export async function testRouteContentTypeDetection() {
  await terminateAfter(
    registryServer(),
    createRoute('/json', () => ({ type: 'json' })),
    createRoute('/html', () => '<html><body>test</body></html>'),
    createRoute('/buffer', () => Buffer.from('binary')),
    async () => {
      const jsonResp = await fetch(`${process.env.MICRO_REGISTRY_URL}/json`)
      const htmlResp = await fetch(`${process.env.MICRO_REGISTRY_URL}/html`)
      const bufferResp = await fetch(`${process.env.MICRO_REGISTRY_URL}/buffer`)
      
      assert([
        jsonResp.headers.get('content-type'),
        htmlResp.headers.get('content-type'),
        bufferResp.headers.get('content-type')
      ],
        ([json, html, buf]) => json.includes('application/json'),
        ([json, html, buf]) => html.includes('text/html'),
        ([json, html, buf]) => buf.includes('octet-stream')
      )
    }
  )
}

// =============================================================================
// Example 3: Performance and Load Testing
// =============================================================================

export async function testConcurrentServiceCalls() {
  await terminateAfter(
    await registryServer(),
    await createService('concurrent', (payload) => ({
      id: payload.id,
      timestamp: Date.now()
    })),
    async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        callService('concurrent', { id: i })
      )
      
      const results = await Promise.all(promises)
      
      await assert(results,
        r => r.length === 20,
        r => r.every((res, idx) => res.id === idx),
        r => r.every(res => typeof res.timestamp === 'number')
      )
    }
  )
}

export async function testRapidSequentialCalls() {
  let count = 0
  await terminateAfter(
    await registryServer(),
    await createService('counter', () => {
      return { count: ++count }
    }),
    async () => {
      const results = []
      for (let i = 0; i < 50; i++) {
        results.push(await callService('counter', {}))
      }
      
      assert(results,
        r => r.length === 50,
        r => r[0].count === 1,
        r => r[49].count === 50
      )
    }
  )
}

// =============================================================================
// Example 4: Solo and Mute Patterns
// =============================================================================

export function testNormalExecution() {
  assert(true, t => t === true)
}

// Mark this test as solo - only solo tests will run when present
// Activate solo mode:
// testSoloFeature.solo = true
export function testSoloFeature() {
  assert('solo', s => s === 'solo')
}

// Mark this test as muted - it will be skipped
// Activate mute:
// testMutedFeature.mute = true
export function testMutedFeature() {
  assert('muted', m => m === 'muted')
}

// =============================================================================
// Example 5: Running the Test Suite
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new TestRunner()
  
  // Add test suites with descriptive names
  runner.addSuite('service-patterns', [
    testBasicServiceCreation,
    testServiceWithDependency,
    testServiceErrorHandling
  ])
  
  runner.addSuite('route-patterns', [
    testRouteWithMethod,
    testRouteContentTypeDetection
  ])
  
  runner.addSuite('performance', [
    testConcurrentServiceCalls,
    testRapidSequentialCalls
  ])
  
  runner.addSuite('test-runner-features', [
    testNormalExecution,
    testSoloFeature,
    testMutedFeature
  ])
  
  // Add imported test case files
  // These will automatically get suite names from their file structure
  runner.addSuite('crypto-utilities', cryptoTests)
  runner.addSuite('edge-cases', edgeCaseTests)
  
  // Run all suites
  runner.run()
    .then(() => {
      process.exit(0)
    })
    .catch(err => {
      process.exit(1)
    })
}

// =============================================================================
// Documentation Notes for Contributors
// =============================================================================

/*

## Key Patterns Demonstrated:

1. **Named Exports**: All test functions are exported by name, making them
   easy to import selectively or use with `import *`

2. **Suite Organization**: Tests are grouped into logical suites that reflect
   feature areas (services, routes, performance, etc.)

3. **Async/Await**: All test functions use async/await for consistency, even
   when not strictly necessary

4. **terminateAfter Helper**: Automatically cleans up servers and services
   after test execution, even on failure

5. **Multiple Assertions**: Use multiple assertion functions to validate
   different aspects of the result in one test

6. **Solo/Mute Flags**: Control test execution during development:
   - Set `.solo = true` to run only specific tests
   - Set `.mute = true` to skip specific tests

## Running Tests:

```bash
# Run this file directly
node test/example-suite-patterns.js

# Or import and use in another test runner
import * as patterns from './test/example-suite-patterns.js'
```

## Best Practices:

- ✅ Export all test functions by name
- ✅ Use descriptive test names that explain what is being tested
- ✅ Group related tests into suites
- ✅ Always clean up resources (use terminateAfter)
- ✅ Test both success and failure cases
- ✅ Use multiple assertions to validate different aspects
- ❌ Don't use default exports (harder to compose)
- ❌ Don't leave solo/mute flags in committed code
- ❌ Don't share state between tests (use closures in createService if needed)

*/

