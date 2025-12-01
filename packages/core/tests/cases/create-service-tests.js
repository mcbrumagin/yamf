import {
  assert,
  assertErr,
  sleep,
  terminateAfter
} from '@yamf/test'

import {
  registryServer,
  createService,
  createServices,
  callService,
  httpRequest,
  Logger,
  HttpError,
  next,
  HEADERS,
  COMMANDS
} from '../../src/index.js'

const logger = new Logger()

export async function testCreateService() {
  await terminateAfter(
    await registryServer(),
    await createService('test', function testService(payload) {
      payload.prop3 = 'test'
      return payload
    }),
    async () => {
      let result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
        body: { prop1: 'test', prop2: 'test' },
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
          [HEADERS.SERVICE_NAME]: 'test'
        }
      })
      
      await assert(result,
        r => r.prop1 === 'test',
        r => r.prop2 === 'test', 
        r => r.prop3 === 'test'
      )
      
      return result
    }
  )
}

export async function testCallService() {
  await terminateAfter(
    await registryServer(),
    await createService('test', function testService() {
      return 'TEST SERVICE RESULT'
    }),
    async () => {
      let result = await callService('test', { prop1: 'wow', prop2: 'it works' })
      await assert(result, r => r === 'TEST SERVICE RESULT')
      return result
    }
  )
}


export async function testBasicDependentService() {
  await terminateAfter(
    await registryServer(),
    await createService('test2', async function testService2(payload) {
      return { ...payload, test2: 'called test2' }
    }),
    await createService('test', function testService(payload) {
      return this.call('test2', { ...payload, test: 'called test' }) 
    }),
    async () => {
      let result = await callService('test', { prop1: 'wow', prop2: 'it works' })
      assert(result,
        r => r.prop1 === 'wow',
        r => r.prop2 === 'it works',
        r => r.test === 'called test',
        r => r.test2 === 'called test2'
      )
    }
  )
}

export async function testMissingService() {
  await terminateAfter(
    await registryServer(),
    async () => {
      await assertErr(
        async () => callService('test', { prop1: 'wow', prop2: 'it fails' }),
        err => err.message.includes('No service by name "test"')
      )
    }
  )
}


export async function testMissingDependentService() {
  await terminateAfter(
    await registryServer(),
    await createService('test', function testService(payload) {
      return this.call('test2', payload + ' plus bad call') 
    }),
    async () => {
      await assertErr(
        async () => callService('test', { prop1: 'wow', prop2: 'it fails' }),
        err => err.message.includes('No service by name "test2" in cache')
      )
    }
  )
}

export async function testDependentServicesWithContextCall() {
  return terminateAfter(
    registryServer(),
    createService('test', payload => `|TEST| ${payload}`),
    createService(async function test2(payload) {
      return await this.call('test', `test2 payload: ${payload}`) + ' test2 result'
    }),
    createService(async function test3(payload) {
      return await this.call('test2', `test3 payload: ${payload}`) + ' test3 result'
    }),
    createService(async function test4() {
      return await this.call('test3', 'test4 payload') + ' test4 result'
    }),
    async () => assert(await callService('test4'),
      r => r.includes('|TEST|'),
      r => r.includes('test2 payload'),
      r => r.includes('test2 result'),
      r => r.includes('test3 payload'),
      r => r.includes('test3 result'),
      r => r.includes('test4 payload'),
      r => r.includes('test4 result')
    )
  )
}

// testing what partially migrated code might look like
export async function testDependentServicesWithInlineFnCalls() {
  function test(payload) {
    return `|TEST| ${payload}`
  }
  async function test2(payload) {
    return test(`test2 payload: ${payload}`) + ' test2 result'
  }
  async function test3(payload) {
    return await test2(`test3 payload: ${payload}`) + ' test3 result'
  }
  async function test4() {
    return await test3('test4 payload') + ' test4 result'
  }

  return terminateAfter(
    registryServer(),
    createService(test),
    createService(test2),
    createService(test3),
    createService(test4),
    async () => {
      let result = await callService('test4')
      assert(result,
        r => r.includes('|TEST|'),
        r => r.includes('test2 payload'),
        r => r.includes('test2 result'),
        r => r.includes('test3 payload'),
        r => r.includes('test3 result'),
        r => r.includes('test4 payload'),
        r => r.includes('test4 result')
      )
    }
  )
}

export async function testDependentServicesWithBulkCreate() {
  function test(payload) {
    return `|TEST| ${payload}`
  }
  async function test2(payload) {
    return await test(`test2 payload: ${payload}`) + ' test2 result'
  }
  async function test3(payload) {
    return await test2(`test3 payload: ${payload}`) + ' test3 result'
  }
  async function test4() {
    return await test3('test4 payload') + ' test4 result'
  }

  return terminateAfter(
    registryServer(),
    createServices(test, test2, test3, test4),
    async () => {
      let result = await callService('test4')
      assert(result,
        r => r.includes('|TEST|'),
        r => r.includes('test2 payload'),
        r => r.includes('test2 result'),
        r => r.includes('test3 payload'),
        r => r.includes('test3 result'),
        r => r.includes('test4 payload'),
        r => r.includes('test4 result')
      )
    }
  )
}

export async function testDependentServicesContextCallWithBulkCreate() {
  function test(payload) {
    return `|TEST| ${payload}`
  }
  async function test2(payload) {
    return await this.test(`test2 payload: ${payload}`) + ' test2 result'
  }
  async function test3(payload) {
    return await this.test2(`test3 payload: ${payload}`) + ' test3 result'
  }
  async function test4() {
    return await this.test3('test4 payload') + ' test4 result'
  }
  return await terminateAfter(
    await registryServer(),
    createServices(test, test2, test3, test4),
    async () => {
      let result = await callService('test4')
      assert(result,
        r => r.includes('|TEST|'),
        r => r.includes('test2 payload'),
        r => r.includes('test2 result'),
        r => r.includes('test3 payload'),
        r => r.includes('test3 result'),
        r => r.includes('test4 payload'),
        r => r.includes('test4 result')
      )
    }
  )
}


export async function testDependentServicesContextCall() {
  function test(payload) {
    return `|TEST| ${payload}`
  }
  async function test2(payload) {
    return await this.test(`test2 payload: ${payload}`) + ' test2 result'
  }
  async function test3(payload) {
    return await this.test2(`test3 payload: ${payload}`) + ' test3 result'
  }
  async function test4() {
    return await this.test3('test4 payload') + ' test4 result'
  }
  return await terminateAfter(
    await registryServer(),
    await createService(test4),
    await createService(test3),
    await createService(test2),
    await createService(test),
    async () => {
      let result = await callService('test4')
      assert(result,
        r => r.includes('|TEST|'),
        r => r.includes('test2 payload'),
        r => r.includes('test2 result'),
        r => r.includes('test3 payload'),
        r => r.includes('test3 result'),
        r => r.includes('test4 payload'),
        r => r.includes('test4 result')
      )
    }
  )
}

// callService (instead of using this.call) forces an eager lookup
export async function testDependentServiceWithEagerLookup() {
  // process.env.YAMF_REGISTRY_URL = 'http://localhost:10000' // this just gets used in our registryServer fn
  await terminateAfter(
    await registryServer(),
    await createService('test2', async payload => await callService('test3', payload)),
    await createService('test', async payload => `TEST SERVICE RESULT... ${payload}`),
    await createService(async function test3(payload) {
      let result = await this.call('test', 'HELL')
      return result + ' YEAH BABY' // should be right before " DUDE!"
    }),
    await createService(async function test4(payload) {
      let result = await callService('test2', 'YAY!')
      return result + ', DUDE!' // final result ends with DUDE (1st service call, last append)
    }),
    async () => {
      let result = await callService('test4')
      assert(result,
        r => r.includes('TEST SERVICE RESULT...'),
        r => r.includes('HELL YEAH BABY'),
        r => r.includes('DUDE!')
      )
    }
  )
}

// redundant?
export async function testServiceLookup() {
  await terminateAfter(
    await registryServer(),
    await createService('lookup1', function test1() { return 'test1' }),
    await createService('lookup2', function test2() { return 'test2' }),
    async () => {
      // Test lookup single service
      let service1Location = await httpRequest(process.env.YAMF_REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
          [HEADERS.SERVICE_NAME]: 'lookup1'
        }
      })
      
      await assert(service1Location, l => typeof l === 'string' && l.includes(':'))
      
      // Test lookup all services
      let allServices = await httpRequest(process.env.YAMF_REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_LOOKUP,
          [HEADERS.SERVICE_NAME]: '*'
        }
      })
      
      assert(allServices,
        s => Array.isArray(s.lookup1) && s.lookup1.length > 0,
        s => Array.isArray(s.lookup2) && s.lookup2.length > 0
      )
    }
  )
}

export async function testDependentServiceThrowsError() {
  await terminateAfter(
    await registryServer(),
    await createService(async function test() {
      return await this.call('test2')
    }),
    await createService(async function test2() {
      throw new Error('Test error from inside test2 service')
    }),
    async () => {
      await assertErr(
        async () => callService('test'),
        err => err.message.includes('Test error from inside test2 service'),
        err => err.stack.includes('in service "test"'),
        err => err.stack.includes('test2'),
        err => err.status === 500,
        err => err.isServerError,
        err => err.name.includes('HttpServerError')
      )
    }
  )
}

export async function testServiceRegistrationFailure() {
  // Test what happens when registry is not available
  let originalEndpoint = process.env.YAMF_REGISTRY_URL
  process.env.YAMF_REGISTRY_URL = 'http://localhost:42069' // nice
  
  try {
    logger.muteWarn()
    await assertErr(
      async () => createService('testService', () => 'test'),
      err => err.message.includes('fetch failed')
        || err.message.includes('ECONNREFUSED')
    )
  } finally {
    process.env.YAMF_REGISTRY_URL = originalEndpoint
    logger.unmuteWarn()
  }
}

export async function testCallServiceWithInvalidPayload() {
  await terminateAfter(
    await registryServer(),
    await createService(function payloadTest(payload) {
      if (!payload || !payload.required) {
        throw new HttpError(400, 'Missing required field')
      }
      return { success: true, received: payload.required }
    }),
    async () => {
      // Test successful call
      let result = await callService('payloadTest', { required: 'value' })
      assert(result.success, s => s === true)
      
      // Test missing payload
      await assertErr(
        async () => callService('payloadTest', {}),
        err => err.message.includes('Missing required field')
      )
    }
  )
}

export async function testServiceDynamicPorts() {
  await terminateAfter(
    registryServer(),
    createService(function test1() { return 'service1' }),
    createService(function test2() { return 'service2' }),
    async (registry, service1, service2) => {
      // Both should be created successfully on different ports
      await assert([service1.location, service2.location],
        ([l1,   ]) => l1.includes('http://localhost:'),
        ([  , l2]) => l2.includes('http://localhost:'),
        ([l1, l2]) => l1 !== l2
      )

      await assert(Promise.all([
        callService('test1'),
        callService('test2')
      ]),
        ([r1,   ]) => r1 === 'service1',
        ([  , r2]) => r2 === 'service2'
      )
    }
  )
}

export async function testLoadBalancing() {
  await terminateAfter(
    await registryServer(),
    await createService('loadTest', function loadTestService1() { return 'instance1' }),
    await createService('loadTest', function loadTestService2() { return 'instance2' }),
    await createService('loadTest', function loadTestService3() { return 'instance3' }),
    async () => {
      let start = Date.now()
      let results = new Set()
      
      // Call service multiple times to test round-robin
      while (results.size < 3 && (Date.now() - start) < 1000) {
        let result = await callService('loadTest')
        results.add(result)
        await sleep(50)
      }
      
      // Should hit all three instances
      assert(results,
        r => r.size === 3,
        r => r.has('instance1') === true,
        r => r.has('instance2') === true,
        r => r.has('instance3') === true
      )
      
      return Array.from(results)
    }
  )
}

export async function testEmptyServiceName() {
  await terminateAfter(
    registryServer(),
    () => assertErr(async () => createService('', () => 'test'),
      // err => err.message.includes('Server handler cannot be an anonymous function'), // passes but should it?
      err => err.message.includes('Please provide a function'),
      err => err.message.includes('service name and its function')
    )
  )
}

export async function testServiceWithSpecialCharacters() {
  await terminateAfter(
    registryServer(),
    createService('test-service', () => 'dash'),
    createService('test_service', () => 'underscore'),
    async () => assert([await callService('test-service'), await callService('test_service')],
      results => results[0] === 'dash',
      results => results[1] === 'underscore'
    )
  )
}

export async function testLargePayload() {
  await terminateAfter(
    await registryServer(),
    await createService('largePayload', (payload) => {
      return { received: payload.data.length, echo: payload.data.substring(0, 10) + '...' }
    }),
    async () => {
      let largeData = 'x'.repeat(10000) // 10KB string
      let result = await callService('largePayload', { data: largeData })
      
      assert(result,
        r => r.received === 10000,
        r => r.echo === 'xxxxxxxxxx...'
      )
    }
  )
}

export async function testFileStreamService() {
  const fs = await import('fs')
  const path = await import('path')
  
  await terminateAfter(
    registryServer(),
    createService('fileStream', async (payload, request, response) => {
      const { url } = payload || {}
      if (url && url.startsWith('/test-files/')) {
        const fileName = url.split('/').pop()
        const testFilePath = path.join(process.cwd(), 'tests/data', fileName)
        
        if (fs.existsSync(testFilePath)) {
          // Use next() to signal we're handling the response directly
          response.writeHead(200, { 'content-type': 'text/html' })
          fs.createReadStream(testFilePath).pipe(response)
          return next({ reason: 'streaming file', file: fileName })
        } else {
          throw new HttpError(404, 'Test file not found')
        }
      } else {
        throw new HttpError(404, 'Invalid test file path')
      }
    }),
    async () => {
      // Test streaming file via HTTP request to registry
      let result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
          [HEADERS.SERVICE_NAME]: 'fileStream'
        },
        body: { url: '/test-files/index.html' }
      })
      
      assert(result,
        r => typeof r === 'string',
        r => r.includes('html') || r.includes('HTML')
      )
    }
  )
}

// TODO is this redundant? does this ACTUALLY work correctly? is it big enough?
export async function testLargeFileStreamService() {
  const fs = await import('fs')
  const path = await import('path')
  
  await terminateAfter(
    await registryServer(),
    await createService('largeFileStream', async function largeFileStreamService(payload, request, response) {
      const { url } = payload || {}
      if (url && url.startsWith('/audio/')) {
        const fileName = url.split('/').pop()
        const testFilePath = path.join(process.cwd(), 'tests/data', fileName)
        
        if (fs.existsSync(testFilePath)) {
          const stats = fs.statSync(testFilePath)
          logger.debug(`Streaming large file: ${fileName}, size: ${stats.size} bytes`)
          
          // Use next() to signal we're handling the response directly
          response.writeHead(200, { 
            'content-type': 'audio/wav',
            'content-length': stats.size
          })
          const stream = fs.createReadStream(testFilePath)
          stream.pipe(response)

          // TODO this works here, but not in upload service for some reason
          return next({ reason: 'streaming large audio file', file: fileName, size: stats.size })
        } else {
          throw new HttpError(404, 'Audio file not found')
        }
      } else {
        throw new HttpError(404, 'Invalid audio file path')
      }
    }),
    async () => {
      const startTime = Date.now()
      
      // Test streaming large file via HTTP request to registry (through proxy)
      let result = await httpRequest(process.env.YAMF_REGISTRY_URL, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
          [HEADERS.SERVICE_NAME]: 'largeFileStream'
        },
        body: { url: '/audio/test-track.wav' }
      })
      
      const endTime = Date.now()
      const duration = endTime - startTime
      
      logger.debug(`Large file stream test completed in ${duration}ms`)
      logger.debug(`Result type: ${typeof result}, length: ${result?.length || 'N/A'}`)
      
      // Check if we got data back
      await assert(result,
        r => typeof r === 'string' || Buffer.isBuffer(r),
        r => (r?.length || 0) > 1000000, // Should be > 1MB
      )
      
      return { duration, size: result?.length }
    }
  )
}

export async function testTextStreamService() {
  const { Readable } = await import('stream')
  
  await terminateAfter(
    await registryServer(),
    await createService('textStream', async function textStreamService(payload, request, response) {
      const { content } = payload || {}
      
      if (content) {
        // Create a readable stream from text content and pipe to response
        response.writeHead(200, { 'content-type': 'text/plain' })
        const stream = Readable.from([content])
        stream.pipe(response)
        return next({ reason: 'streaming text' })
      } else {
        // Normal JSON response when no content
        return { message: 'No content provided' }
      }
    }),
    async () => {
      let testContent = 'This is streaming test content!'
      let result = await callService('textStream', { content: testContent })
      
      await assert(result,
        r => typeof r === 'string',
        r => r.includes('streaming')
      )
      
      return result
    }
  )
}

export async function testMixedResponseHandling() {
  await terminateAfter(
    await registryServer(),
    await createService('hybrid', async function hybridService(payload, request, response) {
      const { raw, customHeader } = payload || {}
      
      if (raw) {
        // Direct response handling with custom headers
        response.writeHead(200, { 
          'content-type': 'text/plain',
          'x-custom-header': customHeader || 'default-value'
        })
        response.end('Raw response from service')
        return next({ reason: 'raw response with custom headers' })
      } else {
        // Normal JSON response
        return { type: 'json', message: 'Normal response' }
      }
    }),
    async () => {
      // Test normal JSON response
      let jsonResult = await callService('hybrid', { data: 'test' })
      await assert(jsonResult,
        r => r.type === 'json',
        r => r.message === 'Normal response'
      )
      
      // Test raw response handling
      let rawResult = await callService('hybrid', { raw: true, customHeader: 'test-value' })
      await assert(rawResult,
        r => typeof r === 'string',
        r => r.includes('Raw response')
      )
      
      return { jsonResult, rawResult }
    }
  )
}

// TODO use checksum to verify different definitions
// need to consider rolling-updates and other use cases
// could have registration locking/unlocking to temporarily allow unique dupes
// could also just warn and leave this up to the user to manage for now
export async function testErrorCreatingMultipleDifferentServicesSameName() {
  await terminateAfter(
    await registryServer(),
    await createService('serviceDupe', () => ({ instance: 1 })),
    async () => {
      throw new Error('TODO unimplemented')
      await assertErr(
        () => createService('serviceDupe', () => ({ instance: 2 })),
        err => err.message.includes('Duplicate service with different definition found: "serviceDupe"')
      )
    },
  )
}

export async function testAnonymousFunctionService() {
  await terminateAfter(
    await registryServer(),
    await createService((payload) => {
      return { message: 'from anonymous', payload }
    }),
    async (registry, server) => {
      await assert(server,
        s => s.name && typeof s.name === 'string',
        s => s.name.includes('Anon$'),
        s => s.location && s.location.includes('http://localhost:')
      )
      
      let result = await callService(server.name, { test: 'data' })
      await assert(result,
        r => r.message === 'from anonymous',
        r => r.payload.test === 'data'
      )
      
      return { serviceName: server.name, result }
    }
  )
}

export async function testAnonymousAsyncFunctionService() {
  await terminateAfter(
    await registryServer(),
    await createService(async (payload) => {
      await sleep(10)
      return { async: true, payload }
    }),
    async (registry, server) => {
      await assert(server.name,
        name => name.includes('Anon$')
      )
      
      let result = await callService(server.name, { value: 42 })
      await assert(result,
        r => r.async === true,
        r => r.payload.value === 42
      )
      
      return result
    }
  )
}

export async function testAnonymousArrowFunctionService() {
  await terminateAfter(
    await registryServer(),
    await createService(payload => ({ arrow: true, ...payload })),
    async (registry, server) => {
      await assert(server.name,
        name => name.includes('Anon$')
      )
      
      let result = await callService(server.name, { original: 'value' })
      await assert(result,
        r => r.arrow === true,
        r => r.original === 'value'
      )
      
      return result
    }
  )
}

export async function testAnonymousWithContextCall() {
  await terminateAfter(
    await registryServer(),
    await createService('helper', payload => `helper: ${payload}`),
    await createService(async function(payload) {
      return await this.call('helper', payload)
    }),
    async (registry, helper, anon) => {
      await assert(anon.name,
        name => name.includes('Anon$')
      )
      
      let result = await callService(anon.name, 'test')
      await assert(result,
        r => r === 'helper: test'
      )
      
      return result
    }
  )
}

export async function testMultipleAnonymousServices() {
  await terminateAfter(
    await registryServer(),
    await createService(payload => ({ service: 1, payload })),
    await createService(payload => ({ service: 2, payload })),
    await createService(payload => ({ service: 3, payload })),
    async (registry, s1, s2, s3) => {
      await assert([s1.name, s2.name, s3.name],
        names => names.every(n => n.includes('Anon$')),
        names => new Set(names).size === 3
      )
      
      let r1 = await callService(s1.name, 'test')
      let r2 = await callService(s2.name, 'test')
      let r3 = await callService(s3.name, 'test')
      
      await assert([r1, r2, r3],
        results => results[0].service === 1,
        results => results[1].service === 2,
        results => results[2].service === 3
      )
      
      return { services: [s1.name, s2.name, s3.name] }
    }
  )
}


/**
 * Test subscription creation on regular service with middleware
 */
export async function testServiceWithMiddleware() {
  await terminateAfter(
    await registryServer(),
    await createService('middleware-service', async (payload) => {
      payload.service = true
      return payload
    }),
    async (registry, service) => {

      service.before(async (payload, request, response) => {
        payload.before = true
        return payload
      })

      let result = await callService('middleware-service', { begin: 'test' })

      await assert(result,
        r => r.service === true,
        r => r.before === true,
        r => r.begin === 'test'
      )
    }
  )
}
