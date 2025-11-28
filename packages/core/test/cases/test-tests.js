import {
  registryServer,
  createService,
  callService,
  HttpError,
} from '../../src/index.js'

import {
  assert,
  assertErr,
  assertEach,
  assertSequence,
  assertErrEach,
  assertErrSequence,
  AssertionFailure,
  AssertionFailureDetail,
  MultiAssertionFailure,
  terminateAfter,
} from '../core/index.js'

// ============================================================================
// Assertion Error Printing Tests
// These tests verify that assertion failures print the failing functions
// ============================================================================

export async function testSingleAssertFailurePrintsFn() {
  try {
    assert(5, n => n > 10) // Will fail
    throw new Error('Should have thrown AssertionFailure')
  } catch (err) {
    await assertErr(err,
      e => e instanceof AssertionFailure,
      e => e.message.includes('failed -> n > 10'),
      e => e.message.includes('for target (number) value = 5')
    )
  }
}

export async function testMultipleAssertFailuresPrintsFns() {
  try {
    assert({status: 'error', code: 500, message: 'Server Error'},
      obj => obj.status === 'success',   // Will fail
      obj => obj.code === 200,           // Will fail  
      obj => obj.message === 'OK',       // Will fail
      obj => obj.timestamp !== undefined // Will fail
    )
    throw new Error('Should have thrown AssertionFailure')
  } catch (err) {
    await assertErr(err,
      e => e instanceof AssertionFailure,
      e => e.message.includes('for target (object) value'),
      e => e.message.includes('{"status":"error","code":500,"message":"Server Error"}'),
      e => e.message.includes('failed -> obj.status === \'success\''),
      e => e.message.includes('failed -> obj.code === 200'),
      e => e.message.includes('failed -> obj.message === \'OK\''),
      e => e.message.includes('failed -> obj.timestamp !== undefined')
    )
  }
}

export async function testSingleAssertAsyncFailurePrintsFn() {
  await terminateAfter(
    await registryServer(),
    await createService('test', async () => ({ value: 5 })),
    async () => {
      try {
        await assert(
          async () => await callService('test', {}),
          result => result.value > 10 // Will fail
        )
        throw new Error('Should have thrown AssertionFailure')
      } catch (err) {
        await assertErr(err,
          e => e instanceof AssertionFailure,
          e => e.message.includes('for target (object)'),
          e => e.message.includes('failed -> result.value > 10'),
          e => e.message.includes('value = {"value":5}')
        )
      }
    }
  )
}

export async function testMultipleAssertAsyncFailuresPrintsFns() {
  await terminateAfter(
    await registryServer(),
    await createService('test', async () => ({ status: 'error', code: 500 })),
    async () => {
      try {
        await assert(
          async () => await callService('test', {}),
          obj => obj.status === 'success',  // Will fail
          obj => obj.code === 200,          // Will fail
          obj => obj.value === 'test'       // Will fail
        )
        throw new Error('Should have thrown AssertionFailure')
      } catch (err) {
        await assertErr(err,
          e => e instanceof AssertionFailure,
          e => e.message.includes('for target (object) value = {"status":"error","code":500}'),
          e => e.message.includes('failed -> obj.status === \'success\''),
          e => e.message.includes('failed -> obj.code === 200'),
          e => e.message.includes('failed -> obj.value === \'test\'')
        )
      }
    }
  )
}

export async function testSingleAssertErrFailurePrintsFn() {
  try {
    assertErr(
      () => { throw new Error('test error') },
      err => err.message === 'wrong message' // Will fail
    )
    throw new Error('Should have thrown AssertionFailure')
  } catch (err) {
    assertErr(err,
      e => e instanceof AssertionFailure,
      e => e.message.includes('failed -> err.message === \'wrong message\''),
      e => e.message.includes('for target (error) value = "test error"')
    )
  }
}

export async function testMultipleAssertErrFailuresPrintsFns() {
  try {
    assertErr(
      () => { throw new HttpError(400, 'Bad Request') },
      err => err.status === 500,           // Will fail
      err => err.message === 'Not Found',  // Will fail
      err => err.code === 'INVALID'        // Will fail
    )
    throw new Error('Should have thrown AssertionFailure')
  } catch (err) {
    await assertErr(err,
      e => e instanceof AssertionFailure,
      e => e.message.includes('for target (error) value = "Bad Request"'),
      e => e.message.includes('failed -> err.status === 500'),
      e => e.message.includes('failed -> err.message === \'Not Found\''),
      e => e.message.includes('failed -> err.code === \'INVALID\'')
    )
  }
}



export async function testSingleAssertErrAsyncFailurePrintsFn() {
  await terminateAfter(
    await registryServer(),
    await createService('failing', async () => {
      throw new HttpError(404, 'Not Found')
    }),
    async () => {
      try {
        await assertErr(
          async () => await callService('failing', {}),
          err => err.status === 500 // Will fail (it's 404)
        )
        throw new Error('Should have thrown AssertionFailure')
      } catch (err) {
        await assertErr(err,
          e => e instanceof AssertionFailure,
          e => e.message.includes('failed -> err.status === 500'),
          e => e.message.includes('for target (error) value = "Not Found"')
        )
      }
    }
  )
}

export async function testMultipleAssertErrAsyncFailuresPrintsFns() {
  await terminateAfter(
    await registryServer(),
    await createService('failing', async () => {
      throw new HttpError(403, 'Forbidden')
    }),
    async () => {
      try {
        await assertErr(
          async () => await callService('failing', {}),
          err => err.status === 404,           // Will fail
          err => err.message === 'Not Found',  // Will fail
          err => err.isServerError === true    // Will fail
        )
        throw new Error('Should have thrown AssertionFailure')
      } catch (err) {
        await assertErr(err,
          e => e instanceof AssertionFailure,
          e => e.message.includes('for target (error) value = "Forbidden"'),
          e => e.message.includes('failed -> err.status === 404'),
          e => e.message.includes('failed -> err.message === \'Not Found\''),
          e => e.message.includes('failed -> err.isServerError === true')
        )
      }
    }
  )
}

// ============================================================================
// Promise-Returning Function Tests
// These tests verify that promise-returning functions work correctly
// ============================================================================

export async function testAssertWithPromiseReturningFunction() {
  await terminateAfter(
    await registryServer(),
    await createService('test', async () => ({ value: 10 })),
    async () => {
      // Promise-returning function (not async, but returns a promise)
      await assert(
        () => callService('test', {}),
        result => result.value === 10
      )
    }
  )
}

export async function testAssertErrWithPromiseRejectingFunction() {
  await terminateAfter(
    await registryServer(),
    await createService('failing', async () => {
      throw new HttpError(500, 'Internal Error')
    }),
    async () => {
      // throw new Error('TODO fix')
      // Promise-rejecting function (not async, but returns rejecting promise)
      await assertErr(
        () => callService('failing', {}),
        err => err.status === 500,
        err => err.message === 'Internal Error'
      )
    }
  )
}

// ============================================================================
// assertEach Tests
// ============================================================================

export function testAssertEach_SyncValues() {
  assertEach([1, 2, 3, 4, 5],
    n => n > 0,
    n => n < 10
  )
}

export async function testAssertEach_AsyncValues() {
  const promises = [
    Promise.resolve({ status: 'ok' }),
    Promise.resolve({ status: 'ok' }),
    Promise.resolve({ status: 'ok' })
  ]
  
  await assertEach(promises,
    r => r.status === 'ok'
  )
}

export function testAssertEach_FailureShowsIndex() {
  try {
    assertEach([1, 2, 3],
      n => n > 0,
      n => n < 2  // Will fail for values 2 and 3
    )
    throw new Error('Should have thrown')
  } catch (err) {
    assertErr(err,
      e => e instanceof MultiAssertionFailure,
      e => e.message.includes('for target (number) value = 2'),
      e => e.message.includes('for target (number) value = 3'),
      e => e.message.includes('failed -> n < 2')
    )
  }
}

// ============================================================================
// assertSequence Tests
// ============================================================================

export function testAssertSequence_SyncValues() {
  assertSequence([1, 2, 3],
    n => n === 1,
    n => n === 2,
    n => n === 3
  )
}

export async function testAssertSequence_AsyncValues() {
  await assertSequence([
    Promise.resolve('first'),
    Promise.resolve('second'),
    Promise.resolve('third')
  ],
    v => v === 'first',
    v => v === 'second',
    v => v === 'third'
  )
}

export function testAssertSequence_RequiresMatchingLength() {
  try {
    assertSequence([1, 2], n => n === 1)
    throw new Error('Should have thrown')
  } catch (err) {
    assertErr(err, e => e.message.includes('arguments to be the same length'))
  }
}

export function testAssertSequence_FailureShowsSpecificAssertion() {
  try {
    assertSequence([1, 2, 3],
      n => n === 1,
      n => n === 99,  // Will fail
      n => n === 3
    )
    throw new Error('Should have thrown')
  } catch (err) {
    assertErr(err,
      e => e instanceof AssertionFailure,
      e => e.message.includes('for target (number) value = 2'),
      e => e.message.includes('failed -> n === 99')
    )
  }
}

// ============================================================================
// assertErrEach Tests
// ============================================================================

export function testAssertErrEach_ErrorObjects() {
  assertErrEach([
    new Error('test1'),
    new Error('test2'),
    new Error('test3')
  ],
    err => err instanceof Error,
    err => err.message.includes('test')
  )
}

export function testAssertErrEach_ThrowingFunctions() {
  assertErrEach([
    () => { throw new Error('error1') },
    () => { throw new Error('error2') }
  ],
    err => err instanceof Error,
    err => err.message.includes('error')
  )
}

export async function testAssertErrEach_AsyncThrowingFunctions() {
  await assertErrEach([
    async () => { throw new Error('async1') },
    async () => { throw new Error('async2') }
  ],
    err => err instanceof Error,
    err => err.message.includes('async')
  )
}

export async function testAssertErrEach_WithServices() {
  await terminateAfter(
    await registryServer(),
    await createService('failing1', async () => {
      throw new HttpError(404, 'Not Found')
    }),
    await createService('failing2', async () => {
      throw new HttpError(500, 'Server Error')
    }),
    async () => {
      await assertErrEach([
        async () => await callService('failing1'),
        async () => await callService('failing2')
      ],
        err => err instanceof HttpError,
        err => err.status >= 400
      )
    }
  )
}

export function testAssertErrEach_FailureShowsIndex() {
  try {
    assertErrEach([
      new Error('test1'),
      new Error('test2')
    ], err => err.message === 'wrong' )// Will fail for both
    throw new Error('Should have thrown')
  } catch (err) {
    assertErr(err,
      e => e instanceof MultiAssertionFailure,
      e => e.message.includes('for target (error) value = "test1"'),
      e => e.message.includes('for target (error) value = "test1"'),
      e => e.message.includes('failed -> err.message === \'wrong\'')
    )
  }
}

// ============================================================================
// assertErrSequence Tests
// ============================================================================

export function testAssertErrSequence_ErrorObjects() {
  assertErrSequence([
    new Error('first'),
    new Error('second')
  ],
    err => err.message === 'first',
    err => err.message === 'second'
  )
}

export function testAssertErrSequence_ThrowingFunctions() {
  assertErrSequence([
    () => { throw new HttpError(404, 'Not Found') },
    () => { throw new HttpError(500, 'Server Error') }
  ],
    err => err.status === 404,
    err => err.status === 500
  )
}

export async function testAssertErrSequence_AsyncThrowingFunctions() {
  await assertErrSequence([
    async () => { throw new HttpError(400, 'Bad Request') },
    async () => { throw new HttpError(401, 'Unauthorized') },
    async () => { throw new HttpError(403, 'Forbidden') }
  ],
    err => err.status === 400,
    err => err.status === 401,
    err => err.status === 403
  )
}

export async function testAssertErrSequence_WithServices() {
  await terminateAfter(
    await registryServer(),
    await createService('notFound', async () => {
      throw new HttpError(404, 'Not Found')
    }),
    await createService('serverError', async () => {
      throw new HttpError(500, 'Server Error')
    }),
    async () => {
      await assertErrSequence([
        async () => await callService('notFound'),
        async () => await callService('serverError')
      ],
        err => err.status === 404,
        err => err.status === 500
      )
    }
  )
}

export function testAssertErrSequence_RequiresMatchingLength() {
  try {
    assertErrSequence([
      new Error('test')
    ],
      err => err.message === 'test',
      err => err.message === 'extra'  // No matching error
    )
    throw new Error('Should have thrown')
  } catch (err) {
    assertErr(err, e => e.message.includes('arguments to be the same length'))
  }
}

export function testAssertErrSequence_FailureShowsSpecificAssertion() {
  try {
    assertErrSequence([
      new Error('first'),
      new Error('second')
    ],
      err => err.message === 'first',
      err => err.message === 'wrong'  // Will fail
    )
    throw new Error('Should have thrown')
  } catch (err) {
    assertErr(err,
      e => e instanceof AssertionFailure,
      e => e.message.includes('for target (error) value = "second"'),
      e => e.message.includes('failed -> err.message === \'wrong\'')
    )
  }
}
