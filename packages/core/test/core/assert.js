import { Logger } from '../../src/index.js'

const logger = new Logger()

export class AssertError extends Error {

  constructor(val, assertType, assertFnMessage) {
    super('Assert Error')
    this.val = val
    if (!assertFnMessage) {
      assertFnMessage = assertType
      assertType = 'assert'
    }
    this.assertType = assertType
    this.name = 'AssertError'

    const getValString = () => {
      if (typeof val === 'object') {
        val = JSON.stringify(val)
        return val
      } else return `val = ${val}`
    }

    // logger.warn('getValString:', getValString())

    const getErrString = () => `err = ${val.message}` // TODO stack?

    let targetMessageString = !assertType.includes('Err')
      ? getValString() : getErrString()
    
    this.assertMessage = this.name
      + `: "${assertType}" failed\n  for `
      + targetMessageString + '\n'
      + assertFnMessage
  }
}

export class MultiAssertError extends Error {
  constructor(val, assertType, errors) {
    super('Multiple Assert Errors')
    this.val = val
    if (!errors) {
      errors = assertType
      assertType = 'assert'
    }
    this.assertType = assertType
    this.errors = errors
    this.name = 'MultiAssertError'

    const getValString = () => {
      if (typeof val === 'object') val = JSON.stringify(val)
      else return `val = ${val}`
    }

    const getErrString = () => `err = ${val.message}` // TODO stack?
    
    let targetMessageString = !assertType.includes('Err')
      ? getValString() : getErrString()
    
    this.assertMessage = this.name
      + `: "${assertType}" failed\n  for `
      + targetMessageString + '\n'
      + errors.map(e => e.message).join('\n')
  }
}

export function assert(valOrFn, ...assertFns) {
  let result
  if (typeof valOrFn === 'function') result = valOrFn()
  else result = valOrFn
  // logger.warn('result:', result)

  // Handle single assertion function (backward compatibility)
  if (assertFns.length === 1) {
    let assertResult = assertFns[0](result)
    if (assertResult != true) throw new AssertError(result, 'assert', `  assertFn: ${assertFns[0].toString()}`)
    return
  }

  // Handle multiple assertion functions
  let errors = assertFns.map(assertFn => {
    let assertResult = assertFn(result)
    if (assertResult != true) return new Error(
      `  assertFn: ${assertFn.toString()}`
    )
  })

  errors = errors.filter(e => e instanceof Error)
  if (errors.length > 1) throw new MultiAssertError(result, 'assert', errors)
  else if (errors.length === 1) throw errors[0]
}

export async function assertOn(valOrFn, ...assertFns) {
  let result
  if (typeof valOrFn === 'function') result = await valOrFn()
  else result = valOrFn
  // logger.warn('result:', result)

  // Handle single assertion function (backward compatibility)
  if (assertFns.length === 1) {
    let assertResult = await assertFns[0](result)
    if (assertResult != true) throw new AssertError(result, 'assertOn', `  assertOnFn: ${assertFns[0].toString()}`)
    return
  }

  // Handle multiple assertion functions
  let errors = await Promise.all(assertFns.map(async assertFn => {
    let assertResult = await assertFn(result)
    if (assertResult != true) return new Error(
      `  assertOnFn: ${assertFn.toString()}`
    )
  }))

  errors = errors.filter(e => e instanceof Error)
  if (errors.length > 1) throw new MultiAssertError(result, 'assertOn', errors)
  else if (errors.length === 1) throw errors[0]
}

export function assertErr(errOrFn, ...assertFns) {
  let err
  if (typeof errOrFn === 'function' /*&& errOrFn.catch*/) {
    try {
      errOrFn()
    } catch (e) {
      err = e
    } finally {
      if (err.terminate) err.terminate()
    }
  } else err = errOrFn

  if (!(err instanceof Error)) {
    let prettyPrintVal = logger.prettyPrint(err)
    let message = `Assert expected an error but received \nval: ${prettyPrintVal}`
    if (typeof errOrFn === 'function') message += `\n fn: ${errOrFn}`
    throw new AssertError(err, 'assertErr', message)
  }

  let errors = assertFns.map(assertFn => {
    let assertResult = assertFn(err)
    if (assertResult != true) return new AssertError(err, 'assertErr', `  assertErrFn: ${assertFn.toString()}`)
  })

  errors = errors.filter(e => e instanceof Error)
  if (errors.length > 1) throw new MultiAssertError(err, 'assertErr', errors)
  else if (errors.length === 1) throw errors[0]
}

export async function assertErrOn(errOrFn, ...assertFns) {
  let err
  if (typeof errOrFn === 'function' /*&& errOrFn.catch*/) {
    try {
      await errOrFn()
        .catch(e => err = e)
        .then(val => err = val)
    } catch (e) {
      err = e
    } finally {
      if (err.terminate) await err.terminate()
    }
  } else err = errOrFn

  if (!(err instanceof Error)) {
    let prettyPrintVal = logger.prettyPrint(err)
    let message = `Assert expected an error but received \nval: ${prettyPrintVal}`
    if (typeof errOrFn === 'function') message += `\n fn: ${errOrFn}`
    throw new AssertError(err, 'assertErrOn', message)
  }

  let errors = await Promise.all(assertFns.map(async assertFn => {
    let assertResult = await assertFn(err)
    if (assertResult != true) return new AssertError(err, 'assertErrOn', `  assertErrOnFn: ${assertFn.toString()}`)
  }))

  errors = errors.filter(e => e instanceof Error)
  if (errors.length > 1) throw new MultiAssertError(err, 'assertErrOn', errors)
  else if (errors.length === 1) throw errors[0]
}
