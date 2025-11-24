import { httpRequest, httpServer } from '../src/http-primitives/index.js'

import {
  registryServer,
  Logger,
  overrideConsoleGlobally
} from '../src/index.js'

import {
  assert,
  assertErr,
  MultiAssertError,
  sleep,
  terminateAfter,
  mergeAllTestsSafely,
  // runTests
} from './core/index.js'
import { runTests } from './core/new-runner.js'

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
  await terminateAfter(
    await httpServer(10000, function test(payload) {
      logger.info(`in test httpServer, got payload "${JSON.stringify(payload)}"`)
      return Date.now()
    }),
    async () => {
      let result = await httpRequest('http://localhost:10000', {
        body: { testPayload: 'testPayload' }
      })
      return new Date() - Number(result) + 'ms request/response time'
    }
  )
}

async function testRegistryHealth() {
  await terminateAfter(
    await registryServer(),
    async ([registry]) => {
      let result = await httpRequest(process.env.MICRO_REGISTRY_URL, {
        headers: { [HEADERS.COMMAND]: COMMANDS.HEALTH }
      })
      
      await assert(result,
        r => r.status === 'ready',
        r => typeof r.timestamp === 'number',
        r => (Date.now() - r.timestamp) < 1000 // Within last second
      )
      
      return result
    }
  )
}

async function testMultipleAssertionFailures() {
  try {
    await assert({status: 'error', code: 500, message: 'Server Error'},
      obj => obj.status === 'success',   // Will fail
      obj => obj.code === 200,           // Will fail  
      obj => obj.message === 'OK',       // Will fail
      obj => obj.timestamp !== undefined // Will fail
    )
  } catch (err) {
    if (err instanceof MultiAssertError) {
      logger.info('Multiple assertion demo - caught errors:', err.message)
      logger.info('Error details:', err.stack.substring(0, 300) + '...')
    } else throw err
  }
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

// TODO solo support for test suites
// TODO cli support for test runs by name or suite
let testFns = mergeAllTestsSafely(
  testHttpServer,
  testRegistryHealth,
  testMultipleAssertionFailures,
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
)

// TODO update readme for test object support, merge helper, solo/mute flags
runTests(testFns)
.then(() => process.exit(0))
.catch(err => {
  logger.error(err.stack)
  process.exit(1)
})
