// TODO
// create tests for core/examples
// tests should be searchable/runnable via cli

/**
 * Run all example tests
 * 
 * This demonstrates different test patterns:
 * - Basic tests without suites
 * - Advanced service tests with suites
 */

import { overrideConsoleGlobally } from '../src/index.js'

overrideConsoleGlobally({
  includeLogLineNumbers: true
})

// Example 1: Basic tests (no suites)
console.log('\n========== Running Basic Tests (no suites) ==========\n')
await import('./examples/example-basic-tests.js')

// Example 2: Service tests (with suites)
console.log('\n\n========== Running Service Tests (with suites) ==========\n')
await import('./examples/example-service-tests.js')

console.log('\n\n✅ All example tests completed successfully!\n')
