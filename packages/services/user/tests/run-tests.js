#!/usr/bin/env node

/**
 * User Service Test Runner
 */

import { TestRunner, withEnv } from '@yamf/test'
import * as userServiceTests from './user-service-tests.js'

async function main() {
  const runner = new TestRunner()
  
  runner.addSuite('user-service', userServiceTests)
  
  await runner.run()
}

main().catch(err => {
  console.error('Test runner failed:', err)
  process.exit(1)
})
