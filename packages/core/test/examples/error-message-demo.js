/**
 * Error Message Formatting Demo
 * 
 * This file demonstrates the improved error messages for assertion failures,
 * especially when working with arrays of functions.
 * 
 * Run this file directly to see the error messages:
 * node test/examples/error-message-demo.js
 */

import { assertErrEach, assertErrSequence } from '../core/index.js'

console.log('=' .repeat(80))
console.log('Error Message Formatting Demo')
console.log('=' .repeat(80))
console.log()

// Example 1: Show improved error message for assertErrEach with functions
console.log('Example 1: assertErrEach with a function that doesn\'t throw')
console.log('-'.repeat(80))
try {
  assertErrEach([
    () => { throw new Error('This one throws correctly') },
    () => { return 'This one does NOT throw - will fail!' },
    () => { throw new Error('This one throws too') }
  ],
    err => err instanceof Error
  )
} catch (err) {
  console.log('Error Message:')
  console.log(err.message)
  console.log()
}

// Example 2: Show improved error message for assertErrSequence
console.log('Example 2: assertErrSequence with wrong error message')
console.log('-'.repeat(80))
try {
  assertErrSequence([
    () => { throw new Error('First error') },
    () => { throw new Error('Second error') },
    () => { throw new Error('Third error') }
  ],
    err => err.message === 'First error',
    err => err.message === 'WRONG MESSAGE',  // This will fail
    err => err.message === 'Third error'
  )
} catch (err) {
  console.log('Error Message:')
  console.log(err.message)
  console.log()
}

// Example 3: Show error message with mixed array (Error objects and functions)
console.log('Example 3: assertErrEach with mixed Error objects and functions')
console.log('-'.repeat(80))
try {
  assertErrEach([
    new Error('Direct error object'),
    () => { throw new Error('Function that throws') },
    () => { return 'Function that does NOT throw' }
  ],
    err => err instanceof Error
  )
} catch (err) {
  console.log('Error Message:')
  console.log(err.message)
  console.log()
}

console.log('=' .repeat(80))
console.log('Demo Complete')
console.log('Notice how the error messages now show:')
console.log('  - "array with N item(s)" instead of [null,null,null]')
console.log('  - Each item is labeled [0], [1], [2] etc.')
console.log('  - Functions are shown as "function", Errors show their message')
console.log('  - Much clearer which item failed!')
console.log('=' .repeat(80))

