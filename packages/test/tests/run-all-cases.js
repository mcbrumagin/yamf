
import {
  TestRunner
} from '../src/index.js'

import {
  overrideConsoleGlobally
} from '@yamf/core'

overrideConsoleGlobally({
  includeLogLineNumbers: true
})

import * as tests from './tests.js'
import * as exampleBasicTests from '../examples/example-basic-tests.js'
import * as exampleServiceTests from '../examples/example-service-tests.js'

// ============================================================================
// Test Suite Configuration
// ============================================================================

const runner = new TestRunner()

runner.addSuites({
  exampleBasicTests,
  exampleServiceTests
})

// Run all test suites
runner.run(tests)
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err.stack)
    process.exit(err.code || 1)
  })
