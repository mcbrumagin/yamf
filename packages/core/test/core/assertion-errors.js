
const getType = (val) => {
  if (val instanceof Error) {
    return `error`
  } else return typeof val
}

const getTargetString = (val, pad) => {
  if (val instanceof Error) {
    return `"${val.message}"`
  } else if (Array.isArray(val) && val.some(v => v instanceof Error)) {
    return `[${val.map(v => `\n${pad+pad}${getValOrErrString(v)}`).join()}\n${pad}]`
  } else if (typeof val === 'object') {
    return JSON.stringify(val)
  } else {
    return val.toString()
  }
}

export class AssertionFailureDetail {
  constructor(distilledTargetValue, failingAssertionFns, childDetails) {
    this.target = distilledTargetValue
    // console.warn("failingAssertionFns?.length > 1", failingAssertionFns?.length > 1)
    this.assertFns = (
      Array.isArray(failingAssertionFns)
      && failingAssertionFns.length > 1
    ) ? failingAssertionFns : [failingAssertionFns]
    if (!this.assertFns) this.assertFns = []
    this.children = childDetails
  }

  toString(depth = 1) {
    let pad = Array.from({ length: depth }, () => '  ').join('')
    let type = getType(this.target)
    let val = getTargetString(this.target, pad)
    // console.warn('deetVal', val)
    // console.warn(this.assertFns)
    let childMessages = this.children?.map(c => {
      `${pad}${c.toString(depth).split('\n').map(l => `${pad}${l}`).join('\n')}`
    })
    childMessages = childMessages || ''
    // console.warn('childMess', childMessages)
    return `${pad}for target (${type}) value = ${val}`
    + this.assertFns.map(fn =>
      `\n${pad}failed -> ${fn?.name || fn.toString().replace(/^\s?.+\=\>\s?/, '')}`
    ).join('')
    + childMessages
  }

  get message() {
    return this.toString()
  }

  get assertMessage() {
    // 0 for no padding, runner will print this on the same initial line
    return this.toString(0)
  }
}

export class AssertionFailure extends Error {
  constructor(distilledTargetObject, assertionFailureDetails) {
    super() // don't care about original message
    this.target = distilledTargetObject
    this.assertionFailureDetails = (
      Array.isArray(assertionFailureDetails)
      && assertionFailureDetails.length > 1
    ) ? assertionFailureDetails : [assertionFailureDetails]
    // if (!this.assertionFailureDetails)
      // this.assertionFailureDetails = []
  }

  toString(depth = 1) {
    let pad = Array.from({ length: depth }, () => '  ').join('')
    // console.warn('assertDeets',this.assertionFailureDetails)
    // console.warn('assertDeets',this.assertionFailureDetails.map(d =>
    //   `${d.toString(2).split('\n').map(l => `${l}`).join('\n')}`
    // ).join('\n'))
    return `${pad}AssertionFailure\n`
    + this.assertionFailureDetails?.map(d =>
      `${d.toString(depth+1).split('\n').map(l => `${l}`).join('\n')}`
    ).join('\n')
  }

  get message() {
    return this.toString()
  }

  get assertMessage() {
    // 0 for no padding, runner will print this on the same initial line
    return this.toString(0)
  }
}


export class MultiAssertionFailure extends Error {
  constructor(assertType, failures) {
    super() // don't care about normal error message

    if (!failures) {
      failures = assertType
      assertType = ''
    }
    this.assertType = assertType
    this.failures = failures
    this.name = 'MultiAssertionFailure'
  }

  toString() {
    let typeMessage = this.assertType
      ? `: "${this.assertType}" failed`
      : ''

    return `${this.name}${typeMessage}\n`
      + this.failures.map(f => f.toString(1)).join('\n')
  }

  get message() {
    return this.toString()
  }

  get assertMessage() {
    return this.toString()
  }
}
