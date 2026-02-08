#!/usr/bin/env node

/**
 * User Service Integration Test Runner
 * 
 * Requires a running PostgreSQL database.
 * 
 * Usage:
 *   node tests/run-integration.js
 * 
 * Or with custom database:
 *   TEST_PSQL_URL=postgres://user:pass@host/db node tests/run-integration.js
 * 
 * Or with environment variables:
 *   PGDATABASE=yamf_test PGUSER=yamf PGPASSWORD=changeme node tests/run-integration.js
 */

import { TestRunner } from '@yamf/test'
import * as integrationTests from './integration-tests.js'

async function main() {
  console.log('='.repeat(60))
  console.log('User Service Integration Tests')
  console.log('='.repeat(60))
  console.log('')
  console.log('Note: These tests require a running PostgreSQL database.')
  console.log('Configure with TEST_PSQL_URL or PGDATABASE/PGUSER/PGPASSWORD')
  console.log('')
  
  const runner = new TestRunner()
  
  runner.addSuite('postgres-integration', {
    testPostgresService_BasicQuery: integrationTests.testPostgresService_BasicQuery,
    testPostgresService_ParameterizedQuery: integrationTests.testPostgresService_ParameterizedQuery,
    testPostgresService_CaseMapping: integrationTests.testPostgresService_CaseMapping,
    testPostgresService_InvalidPlaceholder: integrationTests.testPostgresService_InvalidPlaceholder,
  })
  
  runner.addSuite('user-service-integration', {
    testUserService_SelfSignupFlow: integrationTests.testUserService_SelfSignupFlow,
    testUserService_AdminInviteFlow: integrationTests.testUserService_AdminInviteFlow,
    testUserService_InvalidToken: integrationTests.testUserService_InvalidToken,
    testUserService_TokenRegeneration: integrationTests.testUserService_TokenRegeneration,
    testUserService_DuplicateUsername: integrationTests.testUserService_DuplicateUsername,
    testUserService_UsernameUpdate: integrationTests.testUserService_UsernameUpdate,
    testUserService_RemoveUser: integrationTests.testUserService_RemoveUser,
  })
  
  runner.addSuite('user-service-custom-validation', {
    testUserService_PatternUsernameValidation: integrationTests.testUserService_PatternUsernameValidation,
  })
  
  runner.addSuite('user-service-hooks', {
    testUserService_HooksIntegration: integrationTests.testUserService_HooksIntegration,
  })
  
  await runner.run()
}

main().catch(err => {
  console.error('Integration test runner failed:', err)
  process.exit(1)
})
