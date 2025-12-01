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
  HttpError,
  Logger
} from '../../src/index.js'

const logger = new Logger()

// ============================================================================
// Service Validation Error Tests
// ============================================================================

/**
 * Test creating service with empty name
 */
export async function testServiceWithEmptyName() {
  await terminateAfter(
    registryServer(),
    async () => assertErr(async () => createService('', () => 'test'),
      err => err.message.toLowerCase().includes('service name')
    )
  )
}

/**
 * Test creating service with invalid name (spaces)
 */
export async function testServiceWithSpacesInName() {
  await terminateAfter(
    registryServer(),
    async () => assertErr(async () => createService('invalid service name', () => 'test'),
      err => err.message.toLowerCase().includes('service name')
          || err.message.includes('invalid')
    )
  )
}

/**
 * Test creating service with special characters in name (error validation)
 */
export async function testServiceNameValidationSpecialChars() {
  await terminateAfter(
    await registryServer(),
    async () => assertErr(async () => createService('service@#$%', () => 'test'),
      err => err.message.toLowerCase().includes('service name')
          || err.message.includes('invalid')
    )
  )
}

/**
 * Test calling service that doesn't exist
 */
export async function testCallNonExistentService() {
  await terminateAfter(
    await registryServer(),
    async () => assertErr(async () => callService('doesNotExist', { data: 'test' }),
      err => err.message.includes('No service by name'),
      err => err.message.includes('doesNotExist')
    )
  )
}

// ============================================================================
// HTTP Error Status Code Tests
// ============================================================================

/**
 * Test 404 error from service
 */
export async function testService404Error() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/404-test', async function notFoundService() {
      throw new HttpError(404, 'Resource not found')
    }),
    async () => {
      const response = await fetch(`${process.env.MICRO_REGISTRY_URL}/404-test`)
      const text = await response.text()
      
      assert(response.status, s => s === 404)
      assert(text, t => t.includes('Resource not found'))
    }
  )
}

/**
 * Test 500 error from service
 */
export async function testService500Error() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/500-test', async function errorService() {
      throw new Error('Internal server error')
    }),
    async () => {
      const response = await fetch(`${process.env.MICRO_REGISTRY_URL}/500-test`)
      
      await assert(response.status, s => s === 500)
    }
  )
}

/**
 * Test 400 error from service
 */
export async function testService400Error() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/400-test', async function badRequestService(payload) {
      if (!payload.required) {
        throw new HttpError(400, 'Missing required field: required')
      }
      return 'ok'
    }),
    async () => {
      const response = await fetch(`${process.env.MICRO_REGISTRY_URL}/400-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
      
      await assert(response.status, s => s === 400)
    }
  )
}

/**
 * Test custom error status codes
 */
export async function testCustomErrorStatusCodes() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/403-test', () => { throw new HttpError(403, 'Forbidden') }),
    await createRoute('/409-test', () => { throw new HttpError(409, 'Conflict') }),
    await createRoute('/422-test', () => { throw new HttpError(422, 'Unprocessable') }),
    async () => {
      const resp403 = await fetch(`${process.env.MICRO_REGISTRY_URL}/403-test`)
      const resp409 = await fetch(`${process.env.MICRO_REGISTRY_URL}/409-test`)
      const resp422 = await fetch(`${process.env.MICRO_REGISTRY_URL}/422-test`)
      
      await assert([resp403.status, resp409.status, resp422.status],
        statuses => statuses[0] === 403,
        statuses => statuses[1] === 409,
        statuses => statuses[2] === 422
      )
    }
  )
}

// ============================================================================
// Content Type Detection Tests
// ============================================================================

/**
 * Test HTML content type detection
 */
export async function testHtmlContentTypeDetection() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/html', () => '<html><body>test</body></html>'),
    async () => {
      const response = await fetch(`${process.env.MICRO_REGISTRY_URL}/html`)
      const contentType = response.headers.get('content-type')
      
      await assert(contentType,
        ct => ct !== null,
        ct => ct.includes('text/html')
      )
    }
  )
}

/**
 * Test JSON content type detection
 */
export async function testJsonContentTypeDetection() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/json', () => ({ data: 'test', number: 123 })),
    async () => {
      const response = await fetch(`${process.env.MICRO_REGISTRY_URL}/json`)
      const contentType = response.headers.get('content-type')
      
      await assert(contentType,
        ct => ct !== null,
        ct => ct.includes('application/json')
      )
    }
  )
}

/**
 * Test binary content type detection
 */
export async function testBinaryContentTypeDetection() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/binary', () => Buffer.from([0x89, 0x50, 0x4E, 0x47])),
    async () => {
      const response = await fetch(`${process.env.MICRO_REGISTRY_URL}/binary`)
      const contentType = response.headers.get('content-type')
      
      await assert(contentType,
        ct => ct !== null,
        ct => ct.includes('octet-stream')
      )
    }
  )
}

/**
 * Test multiple content types in sequence
 */
export async function testMultipleContentTypes() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/html', () => '<html>test</html>'),
    await createRoute('/json', () => ({ type: 'json' })),
    await createRoute('/buffer', () => Buffer.from('binary')),
    async () => {
      const htmlResp = await fetch(`${process.env.MICRO_REGISTRY_URL}/html`)
      const jsonResp = await fetch(`${process.env.MICRO_REGISTRY_URL}/json`)
      const bufferResp = await fetch(`${process.env.MICRO_REGISTRY_URL}/buffer`)
      
      const htmlCT = htmlResp.headers.get('content-type')
      const jsonCT = jsonResp.headers.get('content-type')
      const bufferCT = bufferResp.headers.get('content-type')
      
      await assert([htmlCT, jsonCT, bufferCT],
        cts => cts[0].includes('text/html'),
        cts => cts[1].includes('application/json'),
        cts => cts[2].includes('octet-stream')
      )
    }
  )
}

// ============================================================================
// Service Error Propagation Tests
// ============================================================================

/**
 * Test error propagation through service chain
 */
export async function testErrorPropagationThroughChain() {
  await terminateAfter(
    registryServer(),
    createService('errorService', () => {
      throw new HttpError(418, "I'm a teapot")
    }),
    createService('callerService', async function(payload) {
      return await this.call('errorService', payload)
    }),
    async () => assertErr(async () => callService('callerService', {}),
      err => err.status === 418,
      err => err.message.includes('teapot')
    )
  )
}

/**
 * Test timeout error (stub - timeout not yet configurable)
 */
// TODO implement timeout configuration and enable/update this test
export async function testRequestTimeout() {
  await terminateAfter(
    registryServer(),
    createService('slowService', async () => {
      await new Promise(resolve => setTimeout(resolve, 35000)) // Exceeds default 30s timeout
      return 'done'
    }),
    async () => {
      // This should timeout with default 30s timeout
      // TODO: Add configurable timeout via micro-timeout header
      throw new Error('TODO implement timeout configuration and enable/update this test')
      try {
        await callService('slowService', {})
        // If it doesn't timeout, that's ok for now (stub test)
        logger.debug('Timeout not enforced (feature not yet implemented)')
      } catch (err) {
        // If it times out, verify it's a timeout error
        if (err.message.includes('timeout') || err.message.includes('408')) {
          logger.debug('Timeout working as expected')
        }
      }
    }
  )
}

/**
 * Test that registry doesn't crash when calling non-existent service
 * This verifies that unhandled rejections don't crash the registry
 * and that it can continue to process requests after errors
 */
export async function testRegistryStaysHealthyAfterServiceCallError() {
  await terminateAfter(
    await registryServer(),
    await createService('test-service', async () => ({ status: 'ok' })),
    async () => {
      // Try to call non-existent service (this used to cause unhandled rejection)
      try {
        await callService('/health', {})
      } catch (err) {
        // Expected to fail
        await assert(err.message, m => m.includes('No service by name'))
      }
      
      // Verify registry is still healthy and can process subsequent requests
      const result = await callService('test-service', {})
      await assert(result, r => r.status === 'ok')
      
      // Try another bad call to verify registry is still handling errors properly
      try {
        await callService('another-non-existent-service', {})
      } catch (err) {
        // Expected to fail
        await assert(err.message, m => m.includes('No service by name'))
      }
      
      // Verify registry still works
      const result2 = await callService('test-service', {})
      await assert(result2, r => r.status === 'ok')
      
      logger.info('✓ Registry remained healthy after service call errors')
    }
  )
}

/**
 * Test that calling a service with a URL-like name (starting with /) 
 * is handled properly and doesn't crash the registry
 */
export async function testServiceCallWithUrlLikeName() {
  await terminateAfter(
    await registryServer(),

    // service name with leading slash (mimics the user's bug report)
    async () => assertErr(async () => callService('/health', {}),
      err => err.message.includes('No service by name'),
      err => err.message.includes('/health')
    )
  )
}
