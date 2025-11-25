/**
 * Test Runner
 * 
 * Basic Usage:
 * - Run all tests: ./test.sh
 * - Run solo tests only: Mark test function with .solo = true (e.g., testName.solo = true)
 * - Solo tests will run exclusively, ignoring all other tests in the suite
 * - Otherwise, comment out test suites for now, the runner is lacking some features
 */

import crypto from 'crypto'
import { Logger } from '../../src/index.js'

const logger = new Logger({ includeLogLineNumbers: false })

function formatErrorDetails(failedCases) {
  return failedCases.map(({name, err}) => {
    return `\n${name} failed with error: ${err.assertMessage ||err.stack}`
  }).join('\n')
}

// let isSoloRun = false
// let isMuteRun = false
// function filterForSoloOrMutedTests(testFns) {
//   if (testFns.some(fn => fn.solo)) {
//     logger.warn(logger.writeColor('magenta', `Solo tests: ${testFns.filter(fn => fn.solo).map(fn => fn.name).join(', ')}`))
//     isSoloRun = true
//     // todo count skipped tests
//     return testFns.filter(fn => fn.solo)
//   } else if (testFns.some(fn => fn.mute)) {
//     logger.warn(logger.writeColor('magenta', `Muted tests: ${testFns.filter(fn => fn.mute).map(fn => fn.name).join(', ')}`))
//     isMuteRun = true
//     // todo count skipped tests
//     return testFns.filter(fn => !fn.mute)
//   } else {
//     return testFns
//   }
// }


function orchestrateForSoloOrMutedTests(testFns) {
  let isSoloRun = false
  let isMuteRun = false
  let skippedCases = []
  let runCases = []
  
  if (testFns.some(fn => fn.solo)) {
    logger.warn(logger.writeColor('magenta', `Solo tests: ${testFns.filter(fn => fn.solo).map(fn => fn.name).join(', ')}`))
    isSoloRun = true
    skippedCases = testFns.filter(fn => !fn.solo || fn.mute)
    runCases = testFns.filter(fn => fn.solo)
  } else if (testFns.some(fn => fn.mute)) {
    logger.warn(logger.writeColor('magenta', `Muted tests: ${testFns.filter(fn => fn.mute).map(fn => fn.name).join(', ')}`))
    isMuteRun = true
    skippedCases = testFns.filter(fn => fn.mute)
    runCases = testFns.filter(fn => !fn.mute)
  } else {
    // No solo or mute flags - run all tests
    runCases = testFns
  }
  
  return { isSoloRun, isMuteRun, skippedCases, runCases }
}


export function mergeAllTestsSafely(...testFnObjects) {
  let finalTestFns = {}
  let duplicateNames = []
  for (let testFns of testFnObjects) {
    if (typeof testFns === 'function') {
      if (finalTestFns[testFns.name]) duplicateNames.push(testFns.name)
      finalTestFns[testFns.name] = testFns
    } else if (Array.isArray(testFns)) {
      for (let fn of testFns) {
        if (finalTestFns[fn.name]) duplicateNames.push(fn.name)
        finalTestFns[fn.name] = fn
      }
    } else {
      let testNames = Object.keys(testFns)
      for (let name of testNames) {
        if (finalTestFns[name]) duplicateNames.push(name)
        finalTestFns[name] = testFns[name]
      }
    }
  }
  if (duplicateNames.length > 0) throw new Error(`Duplicate test names: [${duplicateNames.join(', ')}]`)
  return finalTestFns
}


export async function runTestFnsSequentially(testFns) {

  process.on('unhandledRejection', async (reason, promise) => {
    // TODO do something with the rejected promise?
    logger.error(logger.writeColor('magenta', 'Exiting early due to Unhandled Promise Rejection'))
    logger.error(reason.stack)
    if (reason.stack.includes('AssertError: Assert Error')) logger.warn(logger.removeExtraWhitespace(
      `This likely means your assert function is being called synchronously without a return statement.
      Either add await before every assert/assertErr, or make sure its promise is returned by the test function.`
    ))
    process.exit(1)
  })

  let testSuccess = 0
  let successCases = []
  let testFail = 0
  let failedCases = []
  let todoCases = []
  let testSuites = {}


  // support arrays or objects per test runner
  testFns = Array.isArray(testFns) ? testFns : Object.values(testFns)

  let { isSoloRun, isMuteRun, skippedCases, runCases } = orchestrateForSoloOrMutedTests(testFns)

  runCases = runCases.map(fn => {
    // TODO if not async?
    if (fn.constructor.name !== 'AsyncFunction') {
      let originalFn = fn
      fn = async () => originalFn()

      // preserve the name of the original function for test results
      Object.defineProperty(fn, 'name', { value: originalFn.name })
      Object.defineProperty(fn, 'mute', { value: originalFn.mute })
    }
    return async () => {
      if (fn.name.includes('TODO')) {
        todoCases.push(fn.name)
        return
      }
      if (fn.mute) {
        skippedCases.push(fn.name)
        return
      }
      if (fn.suite && !testSuites[fn.suite]) {
        // TODO test suite metadata?
        testSuites[fn.suite] = true
      }
      try {
        let startTime = Date.now()
        await fn()
        let durationMs = Date.now() - startTime
        logger.info(logger.writeColor('green', `✔ ${fn.name}`) + logger.writeColor('gray', ` (${durationMs}ms)`))
        testSuccess++
        successCases.push(fn.name)
      } catch (err) {
        if (err.message.includes('TODO')) {
          todoCases.push(fn.name)
          return
        }
        logger.error(logger.writeColor('red', `✘ ${fn.name}`))
        if (err.message.includes('terminateAfter')) {
          logger.error(logger.writeColor('magenta', 'Exiting early due to failure in terminateAfter: ', err.stack))
          process.exit(1)
        }
        testFail++
        failedCases.push({name: fn.name, err})
      }
    }
  })
  
  let startTime = Date.now()
  for (let testFn of runCases) {
    if (typeof testFn !== 'function') {
      logger.error(logger.writeColor('red', `✘ not a function? ${testFn.toString().slice(0, 100)}...`))
    } else {
      await testFn()
    }
  }
  let durationMs = Date.now() - startTime

  return {
    testSuccess,
    successCases,
    testFail,
    failedCases,
    skippedCases,
    todoCases,
    durationMs,
    isSoloRun,
    isMuteRun,
    testSuitesCount: Object.keys(testSuites).length
  }
}

function reportTestResults({
  testSuccess, successCases,
  testFail, failedCases,
  testSuitesCount = 0,
  skippedCases = [],
  todoCases = [],
  isSoloRun = false,
  isMuteRun = false,
  durationMs
}) {

  logger.info('\n')
  logger.info(`----- Testing Complete -----`)
  logger.info(`ℹ tests ${testSuccess + testFail}`)
  if (testSuitesCount > 0) logger.info(`ℹ suites ${testSuitesCount}`)
  logger.info(`ℹ pass ${testSuccess}`)
  logger.info(`ℹ fail ${testFail}`)
  // logger.info('ℹ cancelled 0') // TODO
  logger.info(`ℹ skipped ${skippedCases.length}`)
  logger.info(`ℹ todo ${todoCases.length}`)
  logger.info(`ℹ duration_ms ${durationMs}`)
  logger.info('')

  if (testSuccess > 0 && process.env.MUTE_SUCCESS_CASES !== 'true') {
    logger.info(logger.writeColor('green', '✔ ✔ ✔  Success Report  ✔ ✔ ✔'))
    logger.info(logger.writeColor('green', '\n  ' + successCases.join('\n  ')))
    logger.info('')
  }

  if (testFail) {
    logger.info(logger.writeColor('red', '✘ ✘ ✘  Failure Report  ✘ ✘ ✘'))
    logger.info(logger.writeColor('red', '\n  ' + failedCases.map(f => f.name).join('\n  ')))
    logger.info(logger.writeColor('red', '\n' + formatErrorDetails(failedCases)))
  } else logger.info(logger.writeColor('green', '✔ ✔ ✔  All Tests Passed!  ✔ ✔ ✔'))

  if (isSoloRun) logger.warn(logger.writeColor('magenta', 'This was a solo test run, remove "solo" flags for a full test run'))
  if (isMuteRun) logger.warn(logger.writeColor('magenta', 'This was a partially muted test run, remove "mute" flags for a full test run'))
}

export default async function runTests(testSuitesOrFns) {
  let testFns = mergeAllTestsSafely(testSuitesOrFns)

  let testResults = await runTestFnsSequentially(testFns)
  reportTestResults(testResults)
  
  if (testResults.testFail > 0) {
    let err = new Error(`${testResults.testFail} test(s) failed`)
    err.code = testResults.testFail
    throw err
  }
}

function appendMetadataToTestSuiteFn(suiteName, testFn) {
  Object.defineProperty(testFn, 'name', { value: `${suiteName}.${testFn.name}` })
  Object.defineProperty(testFn, 'suite', { value: suiteName })
  return testFn
}

export class TestRunner {
  constructor(testFns) {
    this.testFns = testFns
    this.suites = {}
  }

  addSuite(suiteName, testFns) {
    if (!testFns) {
      testFns = suiteName
      suiteName = suiteName.name
        || suiteName.constructor?.name
        || suiteName[0]?.name
        || suiteName[Object.keys(suiteName)[0]]
        || `Suite ${crypto.randomBytes(4).toString('hex')}`
    }

    if (Array.isArray(testFns)) {
      testFns = testFns.map(fn => appendMetadataToTestSuiteFn(suiteName, fn))
    } else if (!testFns.length && typeof testFns !== 'function' && typeof testFns === 'object') {
      let testFnArray = []
      // Don't modify the original object (it may be read-only Module namespace)
      for (let fnName in testFns) {
        if (fnName === 'default') continue // Skip default export
        if (typeof testFns[fnName] === 'function') {
          const wrappedFn = appendMetadataToTestSuiteFn(suiteName, testFns[fnName])
          testFnArray.push(wrappedFn)
        }
      }
      testFns = testFnArray
    } else throw new Error(`Invalid test suite: "${testFns}"; should be an array or object`)

    if (this.suites[suiteName]) throw new Error(`Test suite "${suiteName}" already exists`)
    this.suites[suiteName] = testFns
  }

  addSuites(...suites) {
    for (let suite of suites) {
      this.addSuite(suite)
    }
  }

  async run(additionalTestFns) {
    if (additionalTestFns) {
      // additionalTestFns is an array or object of standalone test functions
      this.addSuite('standalone', additionalTestFns)
    }
    
    // Merge all suites into a flat structure
    let allTests = []
    for (let suiteName in this.suites) {
      if (this.suites[suiteName] && Array.isArray(this.suites[suiteName])) {
        allTests.push(...this.suites[suiteName])
      }
    }
    
    await runTests(allTests)
  }
}
