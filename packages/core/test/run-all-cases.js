import { httpRequest, httpServer } from '../src/http-primitives/index.js'

import {
  registryServer,
  createService,
  callService,
  Logger,
  HttpError,
  overrideConsoleGlobally
} from '../src/index.js'

import {
  assert,
  assertErr,
  MultiAssertError,
  AssertError,
  terminateAfter,
  TestRunner
} from './core/index.js'

import { HEADERS, COMMANDS } from '../src/shared/yamf-headers.js'

overrideConsoleGlobally({
  includeLogLineNumbers: true
})

const logger = new Logger({
  includeLogLineNumbers: true,
  warnLevel: true
})


// --- Miscellaneous Cases --- //

async function testHttpServer () {
  let start = Date.now()
  await terminateAfter(
    await httpServer(10000, function test(payload) {
      logger.info(`in test httpServer, got payload "${JSON.stringify(payload)}"`)
      return Date.now() - start
    }),
    async () => {
      let result = await httpRequest('http://localhost:10000', {
        body: { testPayload: 'testPayload' }
      })
      assert(result,
        r => typeof r === 'number',
        r => r > 0,
        r => r < 1000
      )
    }
  )
}

async function testRegistryHealth() {
  await terminateAfter(
    await registryServer(),
    async () => {
      let result = await httpRequest(process.env.MICRO_REGISTRY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      })
      
      assert(result,
        r => r.status === 'ready',
        r => typeof r.timestamp === 'number',
        r => (Date.now() - r.timestamp) < 1000 // Within last second
      )
    }
  )
}

// ============================================================================
// Assertion Error Printing Tests
// These tests verify that assertion failures print the failing functions
// ============================================================================

export async function testSingleAssertFailurePrintsFn() {
  try {
    assert(5, n => n > 10) // Will fail
    throw new Error('Should have thrown AssertError')
  } catch (err) {
    await assert(err,
      e => e instanceof AssertError,
      e => e.message.includes('assertFn: n => n > 10'),
      e => e.message.includes('for val = 5')
    )
  }
}

export async function testMultipleAssertFailuresPrintsFns() {
  try {
    assert({status: 'error', code: 500, message: 'Server Error'},
      obj => obj.status === 'success',   // Will fail
      obj => obj.code === 200,           // Will fail  
      obj => obj.message === 'OK',       // Will fail
      obj => obj.timestamp !== undefined // Will fail
    )
    throw new Error('Should have thrown MultiAssertError')
  } catch (err) {
    await assert(err,
      e => e instanceof MultiAssertError,
      e => e.message.includes('for {"status":"error","code":500,"message":"Server Error"}'),
      e => e.message.includes('assertFn: obj => obj.status === \'success\''),
      e => e.message.includes('assertFn: obj => obj.code === 200'),
      e => e.message.includes('assertFn: obj => obj.message === \'OK\''),
      e => e.message.includes('assertFn: obj => obj.timestamp !== undefined')
    )
  }
}

export async function testSingleAssertAsyncFailurePrintsFn() {
  await terminateAfter(
    await registryServer(),
    await createService('test', async () => ({ value: 5 })),
    async () => {
      try {
        await assert(
          async () => await callService('test', {}),
          result => result.value > 10 // Will fail
        )
        throw new Error('Should have thrown AssertError')
      } catch (err) {
        await assert(err,
          e => e instanceof AssertError,
          e => e.message.includes('assertFn: result => result.value > 10'),
          e => e.message.includes('for {"value":5}')
        )
      }
    }
  )
}

export async function testMultipleAssertAsyncFailuresPrintsFns() {
  await terminateAfter(
    await registryServer(),
    await createService('test', async () => ({ status: 'error', code: 500 })),
    async () => {
      try {
        await assert(
          async () => await callService('test', {}),
          obj => obj.status === 'success',  // Will fail
          obj => obj.code === 200,          // Will fail
          obj => obj.value === 'test'       // Will fail
        )
        throw new Error('Should have thrown MultiAssertError')
      } catch (err) {
        await assert(err,
          e => e instanceof MultiAssertError,
          e => e.message.includes('for {"status":"error","code":500}'),
          e => e.message.includes('assertFn: obj => obj.status === \'success\''),
          e => e.message.includes('assertFn: obj => obj.code === 200'),
          e => e.message.includes('assertFn: obj => obj.value === \'test\'')
        )
      }
    }
  )
}

export async function testSingleAssertErrFailurePrintsFn() {
  try {
    assertErr(
      () => { throw new Error('test error') },
      err => err.message === 'wrong message' // Will fail
    )
    throw new Error('Should have thrown AssertError')
  } catch (err) {
    assert(err,
      e => e instanceof AssertError,
      e => e.message.includes('assertErrFn: err => err.message === \'wrong message\''),
      e => e.message.includes('for err = test error')
    )
  }
}

export async function testMultipleAssertErrFailuresPrintsFns() {
  try {
    assertErr(
      () => { throw new HttpError(400, 'Bad Request') },
      err => err.status === 500,           // Will fail
      err => err.message === 'Not Found',  // Will fail
      err => err.code === 'INVALID'        // Will fail
    )
    throw new Error('Should have thrown MultiAssertError')
  } catch (err) {
    await assert(err,
      e => e instanceof MultiAssertError,
      e => e.message.includes('for err = Bad Request'),
      e => e.message.includes('assertErrFn: err => err.status === 500'),
      e => e.message.includes('assertErrFn: err => err.message === \'Not Found\''),
      e => e.message.includes('assertErrFn: err => err.code === \'INVALID\'')
    )
  }
}

export async function testSingleAssertErrAsyncFailurePrintsFn() {
  await terminateAfter(
    await registryServer(),
    await createService('failing', async () => {
      throw new HttpError(404, 'Not Found')
    }),
    async () => {
      try {
        await assertErr(
          async () => await callService('failing', {}),
          err => err.status === 500 // Will fail (it's 404)
        )
        throw new Error('Should have thrown AssertError')
      } catch (err) {
        await assert(err,
          e => e instanceof AssertError,
          e => e.message.includes('assertErrFn: err => err.status === 500'),
          e => e.message.includes('for err = Not Found')
        )
      }
    }
  )
}

export async function testMultipleAssertErrAsyncFailuresPrintsFns() {
  await terminateAfter(
    await registryServer(),
    await createService('failing', async () => {
      throw new HttpError(403, 'Forbidden')
    }),
    async () => {
      try {
        await assertErr(
          async () => await callService('failing', {}),
          err => err.status === 404,           // Will fail
          err => err.message === 'Not Found',  // Will fail
          err => err.isServerError === true    // Will fail
        )
        throw new Error('Should have thrown MultiAssertError')
      } catch (err) {
        await assert(err,
          e => e instanceof MultiAssertError,
          e => e.message.includes('for err = Forbidden'),
          e => e.message.includes('assertErrFn: err => err.status === 404'),
          e => e.message.includes('assertErrFn: err => err.message === \'Not Found\''),
          e => e.message.includes('assertErrFn: err => err.isServerError === true')
        )
      }
    }
  )
}

// ============================================================================
// Promise-Returning Function Tests
// These tests verify that promise-returning functions work correctly
// ============================================================================

export async function testAssertWithPromiseReturningFunction() {
  await terminateAfter(
    await registryServer(),
    await createService('test', async () => ({ value: 10 })),
    async () => {
      // Promise-returning function (not async, but returns a promise)
      await assert(
        () => callService('test', {}),
        result => result.value === 10
      )
    }
  )
}

export async function testAssertErrWithPromiseRejectingFunction() {
  await terminateAfter(
    await registryServer(),
    await createService('failing', async () => {
      throw new HttpError(500, 'Internal Error')
    }),
    async () => {
      // Promise-rejecting function (not async, but returns rejecting promise)
      await assertErr(
        () => callService('failing', {}),
        err => err.status === 500,
        err => err.message === 'Internal Error'
      )
    }
  )
}

// --- Test Suites --- //

import * as serviceTests from './cases/create-service-tests.js'
import * as routesTests from './cases/route-tests.js'
import * as callRouteTests from './cases/call-route-tests.js'
import * as loggerTests from './cases/logger-tests.js'
import * as gatewayTests from './cases/gateway-tests.js'
import * as registryModuleTests from './cases/registry-module-tests.js'
import * as streamingTests from './cases/streaming-tests.js'
import * as headerCommandTests from './cases/header-command-tests.js'
import * as errorHandlingTests from './cases/error-handling-tests.js'
import * as edgeCaseTests from './cases/edge-case-tests.js'
import * as loadBalancerTests from './cases/load-balancer-tests.js'

import * as cacheServiceTests from './cases/services/cache-tests.js'
import * as subscriptionTests from './cases/subscription-tests.js'
import * as staticFileServiceTests from './cases/services/static-file-tests.js'
import * as fileUploadTests from './cases/services/file-upload-tests.js'
import * as authTests from './cases/services/auth-tests.js'
import * as advancedAuthTests from './cases/services/advanced-auth-tests.js'
import * as registryTokenTests from './cases/registry-token-tests.js'
import * as cryptoTests from './cases/crypto-tests.js'
import * as autoRefreshTests from './cases/services/autorefresh-tests.js'

// ============================================================================
// Test Suite Configuration
// ============================================================================

const runner = new TestRunner()

// Assertion Error Printing Tests (marked as solo for focused testing)
const assertionTests = {
  testSingleAssertFailurePrintsFn,
  testMultipleAssertFailuresPrintsFns,
  testSingleAssertAsyncFailurePrintsFn,
  testMultipleAssertAsyncFailuresPrintsFns,
  testSingleAssertErrFailurePrintsFn,
  testMultipleAssertErrFailuresPrintsFns,
  testSingleAssertErrAsyncFailurePrintsFn,
  testMultipleAssertErrAsyncFailuresPrintsFns,
  testAssertWithPromiseReturningFunction,
  testAssertErrWithPromiseRejectingFunction
}

// Mark all assertion tests as solo to focus on them (uncomment to test assertions)
// Object.values(assertionTests).forEach(fn => fn.solo = true)

runner.addSuite('assertion-errors', assertionTests)

// Miscellaneous core tests
runner.addSuite('core-tests', {
  testHttpServer,
  testRegistryHealth
})

// Test case suites from /cases directory
runner.addSuites({
  gatewayTests,
  registryModuleTests,
  serviceTests,
  routesTests,
  callRouteTests,
  loggerTests,
  streamingTests,
  headerCommandTests,
  errorHandlingTests,
  edgeCaseTests,
  loadBalancerTests,
  cacheServiceTests,
  subscriptionTests,
  staticFileServiceTests,
  fileUploadTests,
  authTests,
  advancedAuthTests,
  registryTokenTests,
  cryptoTests,
  autoRefreshTests
})

// Run all test suites
runner.run()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error(err.stack)
    process.exit(1)
  })
