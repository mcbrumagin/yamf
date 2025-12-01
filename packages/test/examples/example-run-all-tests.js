/**
 * Import and run all example tests
 */

import { TestRunner } from '../src/index.js'

const runner = new TestRunner()

runner.addSuites({
  exampleBasicTests: await import('./example-basic-tests.js'),
  exampleServiceTests: await import('./example-service-tests.js'),
})

runner.run()
  .then(() => process.exit(0))
  .catch(err => process.exit(err.code || 1))
