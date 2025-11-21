/**
 * Test Runner
 * 
 * Basic Usage:
 * - Run all tests: ./test.sh
 * - Run solo tests only: Mark test function with .solo = true (e.g., testName.solo = true)
 * - Solo tests will run exclusively, ignoring all other tests in the suite
 * - Otherwise, comment out test suites for now, the runner is lacking some features
 */

import { Logger } from '../../src/index.js'

const logger = new Logger({ includeLogLineNumbers: false })

function formatErrorDetails(failedCases) {
  return failedCases.map(({name, err}) => {
    return `\n${name} failed with error: ${err.assertMessage ||err.stack}`
  }).join('\n')
}

let isSoloRun = false
let isMuteRun = false
function filterForSoloOrMutedTests(testFns) {
  if (testFns.some(fn => fn.solo)) {
    logger.warn(logger.writeColor('magenta', `Solo tests: ${testFns.filter(fn => fn.solo).map(fn => fn.name).join(', ')}`))
    isSoloRun = true
    return testFns.filter(fn => fn.solo)
  } else if (testFns.some(fn => fn.mute)) {
    logger.warn(logger.writeColor('magenta', `Muted tests: ${testFns.filter(fn => fn.mute).map(fn => fn.name).join(', ')}`))
    isMuteRun = true
    return testFns.filter(fn => !fn.mute)
  } else {
    return testFns
  }
}

export async function runTests(testFns) {

  process.on('unhandledRejection', (reason, promise) => {
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


  // support arrays or objects per test runner
  testFns = Array.isArray(testFns) ? testFns : Object.values(testFns)

  testFns = filterForSoloOrMutedTests(testFns)

  testFns = testFns.map(fn => {
    // TODO if not async?
    if (fn.constructor.name !== 'AsyncFunction') {
      let originalFn = fn
      fn = async () => originalFn()

      // preserve the name of the original function for test results
      Object.defineProperty(fn, 'name', { value: originalFn.name })
    }
    return async () => {
      try {
        let result = await fn()
        logger.info(logger.writeColor('green', `✔ ${fn.name}`))
        testSuccess++
        successCases.push(fn.name)
      } catch (err) {
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
  
  for (let testFn of testFns) await testFn()

  logger.info('\n')
  logger.info(`| - - - - -  TESTING COMPLETE  - - - - - |`)
  logger.info(`    TOTAL: ${testSuccess + testFail}`
    + logger.writeColor('green', `    SUCCESS: ${testSuccess}`)
    + logger.writeColor('red', `    FAIL: ${testFail}`))
  logger.info('')

  if (testSuccess > 0 && process.env.MUTE_SUCCESS_CASES !== 'true') {
    logger.info(logger.writeColor('green', '+ + +  SUCCESS CASES  + + +'))
    logger.info(logger.writeColor('green', '\n  ' + successCases.join('\n  ')))
    logger.info('')
  }

  if (testFail) {
    logger.info(logger.writeColor('red', 'x x x  FAILURE CASES  x x x'))
    logger.info(logger.writeColor('red', '\n  ' + failedCases.map(f => f.name).join('\n  ')))
    logger.info(logger.writeColor('red', '\n' + formatErrorDetails(failedCases)))
  } else logger.info(logger.writeColor('green', '| - - - - -  ALL TESTS PASSED! - - - - - |'))

  if (isSoloRun) logger.warn(logger.writeColor('magenta', 'This was a solo test run, remove "solo" flags for a full test run'))
  if (isMuteRun) logger.warn(logger.writeColor('magenta', 'This was a partially muted test run, remove "mute" flags for a full test run'))
}
