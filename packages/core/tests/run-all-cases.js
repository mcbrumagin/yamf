import { httpRequest, httpServer } from '../src/http-primitives/index.js'

import {
  registryServer,
  Logger,
  overrideConsoleGlobally
} from '../src/index.js'

import {
  assert,
  terminateAfter,
  TestRunner
} from '@yamf/test'

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
import * as contentTypeDetectorTests from './cases/content-type-detector-tests.js'
import * as routeRegistryTests from './cases/route-registry-tests.js'
import * as registryAuthTests from './cases/registry-auth-tests.js'
import * as serviceValidatorTests from './cases/service-validator-tests.js'

// ============================================================================
// Test Suite Configuration
// ============================================================================

const runner = new TestRunner()

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
  autoRefreshTests,
  contentTypeDetectorTests,
  routeRegistryTests,
  registryAuthTests,
  serviceValidatorTests
})

// Run all test suites
runner.run()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error(err.stack)
    process.exit(1)
  })
