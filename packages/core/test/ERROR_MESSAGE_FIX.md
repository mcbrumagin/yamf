# Error Message Formatting Fix

## Problem

When using `assertErrEach` or `assertErrSequence` with arrays of functions, error messages were confusing and unhelpful:

```
AssertError: "assertErrEach" failed
  for [null,null]
  assertErrEach failed for item[1] - expected error but none was thrown
```

The `[null,null]` appears because:
1. The assertion functions receive an array of functions as input
2. When formatting the error message, it tries to `JSON.stringify()` the array
3. Functions in JSON.stringify() become `null`
4. This makes it impossible to see what was being tested

## Solution

Enhanced the `AssertError` and `MultiAssertError` classes to detect arrays containing functions and format them more helpfully:

### Before:
```
AssertError: "assertErrEach" failed
  for [null,null,null]
  assertErrEach failed for item[1] - expected error but none was thrown
```

### After:
```
AssertError: "assertErrEach" failed
  for array with 3 item(s):
    [0]: function
    [1]: function
    [2]: function
  assertErrEach failed for item[1] - expected error but none was thrown
```

## Implementation

Modified `getValOrErrString()` in both error classes to:

1. Detect if the value is an array containing functions
2. If yes, format each item with its index:
   - Functions: `[i]: function`
   - Error objects: `[i]: Error("message")`
   - Other values: `[i]: <JSON>`
3. Display as a clear, indexed list

## Benefits

✅ **Clear Index Labels** - Easy to identify which item failed (`[0]`, `[1]`, `[2]`)  
✅ **Function Detection** - Shows "function" instead of `null`  
✅ **Error Messages** - Shows Error objects with their messages  
✅ **Mixed Arrays** - Handles arrays with functions, errors, and other values  
✅ **Backward Compatible** - Doesn't affect other assertion types

## Examples

### Example 1: All Functions
```javascript
assertErrEach([
  () => { throw new Error('error1') },
  () => { return 'no error' },  // Fails!
  () => { throw new Error('error3') }
], err => err instanceof Error)
```

**Error Message:**
```
AssertError: "assertErrEach" failed
  for array with 3 item(s):
    [0]: function
    [1]: function
    [2]: function
  assertErrEach failed for item[1] - expected error but none was thrown
```

### Example 2: Mixed Types
```javascript
assertErrEach([
  new Error('Direct error'),
  () => { throw new Error('Function error') },
  () => { return 'no error' }  // Fails!
], err => err instanceof Error)
```

**Error Message:**
```
AssertError: "assertErrEach" failed
  for array with 3 item(s):
    [0]: Error("Direct error")
    [1]: function
    [2]: function
  assertErrEach failed for item[2] - expected error but none was thrown
```

### Example 3: Wrong Assertion
```javascript
assertErrSequence([
  () => { throw new Error('First') },
  () => { throw new Error('Second') },
  () => { throw new Error('Third') }
],
  err => err.message === 'First',
  err => err.message === 'WRONG',  // Fails!
  err => err.message === 'Third'
)
```

**Error Message:**
```
AssertError: "assertErrSequence" failed
  for array with 3 item(s):
    [0]: function
    [1]: function
    [2]: function
  assertErrSequence failed for error[1] (Second error)
  assertErrFn: err => err.message === 'WRONG'
```

## Demo

Run the demo file to see the improved messages in action:

```bash
node test/examples/error-message-demo.js
```

## Files Modified

- `test/core/assert.js` - Enhanced `AssertError` and `MultiAssertError` classes
- `test/examples/error-message-demo.js` - Created demonstration file
- `test/cases/service-validator-tests.js` - Fixed incorrect test

## Impact

This fix improves developer experience significantly when:
- Testing multiple error conditions
- Debugging assertion failures
- Working with arrays of throwing functions
- Using `assertErrEach` and `assertErrSequence`

All existing tests continue to pass ✅

