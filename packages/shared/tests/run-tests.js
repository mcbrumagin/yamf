/**
 * @yamf/shared Test Runner
 */

import { TestRunner } from '@yamf/test'
import * as validatorTests from './validator-tests.js'

const runner = new TestRunner()

runner.addSuites({
  validatorTests
})

runner.run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err.stack)
    process.exit(1)
  })
