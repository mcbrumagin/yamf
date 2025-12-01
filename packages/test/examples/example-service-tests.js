/**
 * Advanced Service Test Examples - Real-World YAMF Usage
 * 
 * This file demonstrates advanced testing patterns:
 * - Testing microservices with registryServer
 * - Using terminateAfter for automatic cleanup
 * - Testing routes and service dependencies
 * - Error handling and validation
 * - Using TestRunner for organized test suites
 */

import {
  assert,
  assertErr,
  assertEach,
  assertSequence,
  assertErrEach,
  assertErrSequence,
  terminateAfter,
  TestRunner
} from '../src/index.js'

import {
  registryServer,
  createService,
  createRoute,
  callService,
  HttpError,
  Logger
} from '@yamf/core'

const logger = new Logger({ includeLogLineNumbers: true })

// ============================================================================
// Basic Service Tests
// ============================================================================

// Example 1: Create and test a simple service
export async function testBasicService() {
  await terminateAfter(
    await registryServer(),
    await createService('math', (payload) => {
      return payload.a + payload.b
    }),
    async () => {
      const result = await callService('math', { a: 5, b: 3 })
      assert(result, r => r === 8)
    }
  )
}

// Example 2: Test service with validation
export async function testServiceValidation() {
  await terminateAfter(
    await registryServer(),
    await createService('validator', (payload) => {
      if (!payload.email) {
        throw new HttpError(400, 'Email is required')
      }
      if (!payload.email.includes('@')) {
        throw new HttpError(400, 'Invalid email format')
      }
      return { valid: true, email: payload.email }
    }),
    async () => {
      // Test valid email
      const result = await callService('validator', { email: 'test@example.com' })
      assert(result,
        r => r.valid === true,
        r => r.email === 'test@example.com'
      )
      
      // Test missing email
      await assertErr(
        async () => await callService('validator', {}),
        err => err.status === 400,
        err => err.message.includes('Email is required')
      )
      
      // Test invalid email
      await assertErr(
        async () => await callService('validator', { email: 'invalid' }),
        err => err.status === 400,
        err => err.message.includes('Invalid email format')
      )
    }
  )
}

// Example 3: Test service dependencies
export async function testServiceDependencies() {
  await terminateAfter(
    await registryServer(),
    await createService('database', async (payload) => {
      // Simulate database lookup
      const users = { 1: 'Alice', 2: 'Bob' }
      return users[payload.id] || null
    }),
    await createService('userService', async function(payload) {
      // This service depends on database service
      const name = await this.call('database', { id: payload.userId })
      if (!name) {
        throw new HttpError(404, 'User not found')
      }
      return { userId: payload.userId, name }
    }),
    async () => {
      const result = await callService('userService', { userId: 1 })
      assert(result,
        r => r.userId === 1,
        r => r.name === 'Alice'
      )
      
      await assertErr(
        async () => await callService('userService', { userId: 99 }),
        err => err.status === 404,
        err => err.message === 'User not found'
      )
    }
  )
}

// ============================================================================
// Route Testing Examples
// ============================================================================

// Example 4: Test HTTP routes
export async function testHttpRoute() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/api/hello', async (payload, request) => {
      return { message: `Hello ${payload.name || 'World'}!`, method: request.method }
    }),
    async () => {
      const response = await fetch(`${process.env.MICRO_REGISTRY_URL}/api/hello`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' })
      })
      
      const result = await response.json()
      assert(result,
        r => r.message === 'Hello Alice!',
        r => r.method === 'POST'
      )
      assert(response.status, s => s === 200)
    }
  )
}

// Example 5: Test route with wildcard (controller pattern)
export async function testWildcardRoute() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/api/*', async (payload, request) => {
      const path = request.url
      if (path.includes('/users')) {
        return { resource: 'users', data: [{ id: 1, name: 'Alice' }] }
      } else if (path.includes('/posts')) {
        return { resource: 'posts', data: [{ id: 1, title: 'Test Post' }] }
      }
      throw new HttpError(404, 'Resource not found')
    }),
    async () => {
      const usersResp = await fetch(`${process.env.MICRO_REGISTRY_URL}/api/users`)
      const users = await usersResp.json()
      assert(users,
        u => u.resource === 'users',
        u => u.data.length === 1
      )
      
      const postsResp = await fetch(`${process.env.MICRO_REGISTRY_URL}/api/posts`)
      const posts = await postsResp.json()
      assert(posts,
        p => p.resource === 'posts',
        p => p.data.length === 1
      )
    }
  )
}

// ============================================================================
// Advanced Patterns
// ============================================================================

// Example 6: Test concurrent service calls with assertEach
export async function testConcurrentCalls() {
  await terminateAfter(
    await registryServer(),
    await createService('counter', (() => {
      let count = 0
      return () => ({ count: ++count, timestamp: Date.now() })
    })()),
    async () => {
      // Make 10 concurrent calls
      const promises = Array.from({ length: 10 }, () => callService('counter'))
      
      const results = await Promise.all(promises)
      
      // Use assertEach to verify all results have the expected shape
      assertEach(results,
        r => r.count > 0,
        r => typeof r.timestamp === 'number',
        r => r.timestamp > 0
      )
      
      // Additional checks
      assert(results,
        r => r.length === 10,
        r => r.some(result => result.count === 10)
      )
    }
  )
}

// Example 7: Test service with state
export async function testStatefulService() {
  await terminateAfter(
    await registryServer(),
    await createService('cart', (() => {
      const items = []
      return (payload) => {
        if (payload.action === 'add') {
          items.push(payload.item)
          return { items, count: items.length }
        } else if (payload.action === 'clear') {
          items.length = 0
          return { items, count: 0 }
        } else if (payload.action === 'get') {
          return { items, count: items.length }
        }
      }
    })()),
    async () => {
      // Add items
      await callService('cart', { action: 'add', item: 'apple' })
      await callService('cart', { action: 'add', item: 'banana' })
      
      // Check state
      const result = await callService('cart', { action: 'get' })
      assert(result,
        r => r.count === 2,
        r => r.items.includes('apple'),
        r => r.items.includes('banana')
      )
      
      // Clear cart
      const cleared = await callService('cart', { action: 'clear' })
      assert(cleared, r => r.count === 0)
    }
  )
}

// ============================================================================
// Advanced Array Assertion Examples
// ============================================================================

// Example 8: Test multiple services return expected formats
export async function testMultipleServicesWithAssertEach() {
  await terminateAfter(
    await registryServer(),
    await createService('service1', () => ({ id: 1, status: 'ready' })),
    await createService('service2', () => ({ id: 2, status: 'ready' })),
    await createService('service3', () => ({ id: 3, status: 'ready' })),
    async () => {
      const results = await Promise.all([
        callService('service1'),
        callService('service2'),
        callService('service3')
      ])
      
      // All services should return objects with id and status
      assertEach(results,
        r => typeof r.id === 'number',
        r => r.status === 'ready',
        r => r.id > 0
      )
    }
  )
}

// Example 9: Test validation sequence with assertSequence
export async function testValidationSequence() {
  await terminateAfter(
    await registryServer(),
    await createService('validator', (payload) => {
      if (!payload.value) return { valid: false, reason: 'missing' }
      if (typeof payload.value !== 'number') return { valid: false, reason: 'type' }
      if (payload.value < 0) return { valid: false, reason: 'range' }
      return { valid: true }
    }),
    async () => {
      const testCases = [
        callService('validator', {}),
        callService('validator', { value: 'string' }),
        callService('validator', { value: -5 }),
        callService('validator', { value: 10 })
      ]
      
      // Each test case has a specific expected result
      await assertSequence(testCases,
        r => r.valid === false && r.reason === 'missing',
        r => r.valid === false && r.reason === 'type',
        r => r.valid === false && r.reason === 'range',
        r => r.valid === true
      )
    }
  )
}

// Example 10: Test multiple error conditions with assertErrEach
export async function testMultipleErrorConditions() {
  await terminateAfter(
    await registryServer(),
    await createService('strict', (payload) => {
      if (!payload.name) throw new HttpError(400, 'Name required')
      if (payload.name.length < 3) throw new HttpError(400, 'Name too short')
      return { name: payload.name }
    }),
    async () => {
      // All these should throw 400 errors
      await assertErrEach([
        async () => await callService('strict', {}),
        async () => await callService('strict', { name: 'AB' })
      ],
        err => err.status === 400,
        err => err instanceof HttpError,
        err => err.message.length > 0
      )
    }
  )
}

// Example 11: Test specific error sequence with assertErrSequence
export async function testErrorSequence() {
  await terminateAfter(
    await registryServer(),
    await createService('errors', (payload) => {
      if (payload.code === 400) throw new HttpError(400, 'Bad Request')
      if (payload.code === 401) throw new HttpError(401, 'Unauthorized')
      if (payload.code === 404) throw new HttpError(404, 'Not Found')
      if (payload.code === 500) throw new HttpError(500, 'Server Error')
      return { success: true }
    }),
    async () => {
      // Each should throw a specific error
      await assertErrSequence([
        async () => await callService('errors', { code: 400 }),
        async () => await callService('errors', { code: 401 }),
        async () => await callService('errors', { code: 404 }),
        async () => await callService('errors', { code: 500 })
      ],
        err => err.status === 400 && err.message.includes('Bad Request'),
        err => err.status === 401 && err.message.includes('Unauthorized'),
        err => err.status === 404 && err.message.includes('Not Found'),
        err => err.status === 500 && err.message.includes('Server Error')
      )
    }
  )
}

// Example 12: Test pipeline of dependent services
export async function testServicePipeline() {
  await terminateAfter(
    await registryServer(),
    await createService('step1', (payload) => ({ value: payload.input * 2 })),
    await createService('step2', (payload) => ({ value: payload.input + 10 })),
    await createService('step3', (payload) => ({ value: payload.input * 3 })),
    async () => {
      // Process through pipeline
      const step1Result = await callService('step1', { input: 5 })  // 10
      const step2Result = await callService('step2', { input: step1Result.value })  // 20
      const step3Result = await callService('step3', { input: step2Result.value })  // 60
      
      // Use assertSequence to verify each step
      assertSequence([step1Result, step2Result, step3Result],
        r => r.value === 10,
        r => r.value === 20,
        r => r.value === 60
      )
    }
  )
}

// ============================================================================
// Run Tests with TestRunner
// ============================================================================

// only run if this file is the main entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new TestRunner()
  
  runner.addSuite('service-tests', {
    testBasicService,
    testServiceValidation,
    testServiceDependencies,
    testHttpRoute,
    testWildcardRoute,
    testConcurrentCalls,
    testStatefulService,
    testMultipleServicesWithAssertEach,
    testValidationSequence,
    testMultipleErrorConditions,
    testErrorSequence,
    testServicePipeline
  })
  
  // Run all test suites
  runner.run()
    .then(() => process.exit(0))
    .catch(err => process.exit(err.code || 1))
}

/*
 * Key Patterns Demonstrated:
 * 
 * 1. terminateAfter() - Automatic cleanup of servers/services
 * 2. Service dependencies using this.call()
 * 3. HTTP route testing with fetch()
 * 4. Error handling with HttpError and assertErr()
 * 5. Stateful services using closures
 * 6. Concurrent service testing
 * 7. Test organization with TestRunner
 * 8. Wildcard routes for controller patterns
 * 9. assertEach() - Test multiple results with same criteria
 * 10. assertSequence() - Test ordered results with specific criteria
 * 11. assertErrEach() - Test multiple errors with same criteria
 * 12. assertErrSequence() - Test ordered errors with specific criteria
 * 
 * Best Practices:
 * 
 * - Always use terminateAfter() for resource cleanup
 * - Test both success and error cases
 * - Use multiple assertions to verify different aspects
 * - Organize related tests into suites
 * - Name test functions descriptively
 * - Test service dependencies and state management
 * - Use assertEach when testing many similar results
 * - Use assertSequence when each result has specific expectations
 * - Use assertErrEach/assertErrSequence for comprehensive error testing
 */

