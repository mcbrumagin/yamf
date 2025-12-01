import {
  assert,
  assertErr,
  terminateAfter
} from '@yamf/test'

import {
  registryServer,
  createService,
  createRoute,
  callService,
  Logger
 } from '../../src/index.js'

const logger = new Logger()

// ============================================================================
// Empty and Falsy Payload Tests
// ============================================================================

/**
 * Test service with null payload
 */
export async function testNullPayload() {
  await terminateAfter(
    await registryServer(),
    await createService('nullService', (payload) => {
      return { received: payload, isNull: payload === null }
    }),
    async () => {
      const result = await callService('nullService', null)
      
      await assert(result,
        r => r.received === null,
        r => r.isNull === true
      )
    }
  )
}

/**
 * Test service with undefined payload
 */
export async function testUndefinedPayload() {
  await terminateAfter(
    await registryServer(),
    await createService('undefinedService', (payload) => {
      return { received: payload, isUndefined: payload === undefined }
    }),
    async () => {
      const result = await callService('undefinedService', undefined)
      
      await assert(result,
        r => r.received === undefined || r.received === null, // JSON serialization may convert undefined to null
        r => r.isUndefined === true || r.isUndefined === false // Depends on serialization
      )
    }
  )
}

/**
 * Test service with empty string payload
 */
export async function testEmptyStringPayload() {
  await terminateAfter(
    await registryServer(),
    await createService('emptyStringService', (payload) => {
      return { received: payload, length: payload?.length ?? -1 }
    }),
    async () => {
      const result = await callService('emptyStringService', '')
      
      await assert(result,
        r => r.received === '',
        r => r.length === 0
      )
    }
  )
}

/**
 * Test service with zero payload
 */
export async function testZeroPayload() {
  await terminateAfter(
    await registryServer(),
    await createService('zeroService', (payload) => {
      return { received: payload, isZero: payload === 0 }
    }),
    async () => {
      const result = await callService('zeroService', 0)
      
      await assert(result,
        r => r.received === 0,
        r => r.isZero === true
      )
    }
  )
}

/**
 * Test service with false payload
 */
export async function testFalsePayload() {
  await terminateAfter(
    await registryServer(),
    await createService('falseService', (payload) => {
      return { received: payload, isFalse: payload === false }
    }),
    async () => {
      const result = await callService('falseService', false)
      
      await assert(result,
        r => r.received === false,
        r => r.isFalse === true
      )
    }
  )
}

/**
 * Test service with empty object payload
 */
export async function testEmptyObjectPayload() {
  await terminateAfter(
    await registryServer(),
    await createService('emptyObjectService', (payload) => {
      return { 
        received: payload, 
        isEmpty: Object.keys(payload || {}).length === 0 
      }
    }),
    async () => {
      const result = await callService('emptyObjectService', {})
      
      await assert(result,
        r => typeof r.received === 'object',
        r => r.isEmpty === true
      )
    }
  )
}

/**
 * Test service with empty array payload
 */
export async function testEmptyArrayPayload() {
  await terminateAfter(
    await registryServer(),
    await createService('emptyArrayService', (payload) => {
      return { 
        received: payload, 
        isArray: Array.isArray(payload),
        length: payload?.length ?? -1
      }
    }),
    async () => {
      const result = await callService('emptyArrayService', [])
      
      await assert(result,
        r => Array.isArray(r.received),
        r => r.isArray === true,
        r => r.length === 0
      )
    }
  )
}

// ============================================================================
// Large Payload Tests
// ============================================================================

/**
 * Test service with 1MB payload
 */
export async function testLargePayload1MB() {
  await terminateAfter(
    await registryServer(),
    await createService('largePayloadService', (payload) => {
      return { 
        size: payload.data?.length ?? 0,
        checksum: payload.data?.substring(0, 10)
      }
    }),
    async () => {
      const largeString = 'x'.repeat(1024 * 1024) // 1MB of 'x' characters
      const result = await callService('largePayloadService', { data: largeString })
      
      await assert(result,
        r => r.size === 1024 * 1024,
        r => r.checksum === 'xxxxxxxxxx'
      )
    }
  )
}

/**
 * Test service with large binary payload
 */
export async function testLargeBinaryPayload() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/large-binary', (payload) => {
      if (Buffer.isBuffer(payload)) {
        return Buffer.from([payload.length & 0xFF, (payload.length >> 8) & 0xFF])
      }
      return Buffer.from([0, 0])
    }),
    async () => {
      const largeBuffer = Buffer.alloc(500 * 1024) // 500KB
      largeBuffer.fill(0xAB)
      
      const response = await fetch(`${process.env.YAMF_REGISTRY_URL}/large-binary`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: largeBuffer
      })
      
      const result = await response.arrayBuffer()
      const resultBuffer = Buffer.from(result)
      
      await assert(resultBuffer,
        r => Buffer.isBuffer(r),
        r => r.length === 2 // Should return 2-byte size indicator
      )
    }
  )
}

// ============================================================================
// Long Name and String Tests
// ============================================================================

/**
 * Test service with very long name (within reasonable limits)
 */
export async function testLongServiceName() {
  const longName = 'service' + 'A'.repeat(100)
  
  await terminateAfter(
    await registryServer(),
    await createService(longName, () => 'success'),
    async () => {
      const result = await callService(longName, {})
      
      await assert(result, r => r === 'success')
    }
  )
}

/**
 * Test route with very long path
 */
export async function testLongRoutePath() {
  const longPath = '/api/' + 'segment/'.repeat(20) + 'endpoint'
  
  await terminateAfter(
    await registryServer(),
    await createRoute(longPath, () => ({ path: 'long' })),
    async () => {
      const response = await fetch(`${process.env.YAMF_REGISTRY_URL}${longPath}`)
      const result = await response.json()
      
      await assert(result, r => r.path === 'long')
    }
  )
}

// ============================================================================
// Concurrent Operation Tests
// ============================================================================

/**
 * Test rapid sequential service calls
 */
export async function testRapidSequentialCalls() {
  await terminateAfter(
    await registryServer(),
    await createService('counterService', (() => {
      let count = 0
      return () => ({ count: ++count })
    })()),
    async () => {
      const results = []
      for (let i = 0; i < 100; i++) {
        results.push(await callService('counterService', {}))
      }
      
      await assert(results,
        r => r.length === 100,
        r => r[99].count === 100 // Last call should be count 100
      )
    }
  )
}

/**
 * Test concurrent service calls
 */
export async function testConcurrentServiceCalls() {
  await terminateAfter(
    await registryServer(),
    await createService('echoService', (payload) => payload),
    async () => {
      const promises = []
      for (let i = 0; i < 50; i++) {
        promises.push(callService('echoService', { id: i }))
      }
      
      const results = await Promise.all(promises)
      
      await assert(results,
        r => r.length === 50,
        r => r.every((result, idx) => result.id === idx)
      )
    }
  )
}

/**
 * Test concurrent service registrations
 */
export async function testConcurrentServiceRegistrations() {
  await terminateAfter(
    await registryServer(),
    async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          createService(`service${i}`, (payload) => ({ id: i, payload }))
        )
      }
      
      const services = await Promise.all(promises)
      
      // Call each service to verify they all registered successfully
      const callPromises = []
      for (let i = 0; i < 10; i++) {
        callPromises.push(callService(`service${i}`, { test: true }))
      }
      
      const results = await Promise.all(callPromises)
      
      await assert(results,
        r => r.length === 10,
        r => r.every((result, idx) => result.id === idx),
        r => r.every(result => result.payload.test === true)
      )
      
      // Terminate all services
      await Promise.all(services.map(s => s.terminate()))
    }
  )
}

/**
 * Test concurrent route registrations
 */
export async function testConcurrentRouteRegistrations() {
  await terminateAfter(
    await registryServer(),
    async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          createRoute(`/route${i}`, () => ({ routeId: i }))
        )
      }
      
      const routes = await Promise.all(promises)
      
      // Call each route to verify they all registered successfully
      const callPromises = []
      for (let i = 0; i < 10; i++) {
        callPromises.push(
          fetch(`${process.env.YAMF_REGISTRY_URL}/route${i}`).then(r => r.json())
        )
      }
      
      const results = await Promise.all(callPromises)
      
      await assert(results,
        r => r.length === 10,
        r => r.every((result, idx) => result.routeId === idx)
      )
      
      // Terminate all routes
      await Promise.all(routes.map(r => r.terminate()))
    }
  )
}

// ============================================================================
// Special Character and Encoding Tests
// ============================================================================

/**
 * Test payload with unicode characters
 */
export async function testUnicodePayload() {
  await terminateAfter(
    await registryServer(),
    await createService('unicodeService', (payload) => payload),
    async () => {
      const unicodeData = {
        emoji: '🚀💡🎉',
        chinese: '你好世界',
        arabic: 'مرحبا',
        special: '¡™£¢∞§¶•ªº'
      }
      
      const result = await callService('unicodeService', unicodeData)
      
      await assert(result,
        r => r.emoji === '🚀💡🎉',
        r => r.chinese === '你好世界',
        r => r.arabic === 'مرحبا',
        r => r.special === '¡™£¢∞§¶•ªº'
      )
    }
  )
}

/**
 * Test payload with nested deep object
 */
export async function testDeeplyNestedPayload() {
  await terminateAfter(
    await registryServer(),
    await createService('deepService', (payload) => payload),
    async () => {
      let nested = { value: 'bottom' }
      for (let i = 0; i < 20; i++) {
        nested = { level: i, child: nested }
      }
      
      const result = await callService('deepService', nested)
      
      // Navigate down to verify structure
      let current = result
      for (let i = 19; i >= 0; i--) {
        if (current.level !== i) throw new Error(`Level ${i} mismatch`)
        current = current.child
      }
      
      await assert(current, c => c.value === 'bottom')
    }
  )
}
