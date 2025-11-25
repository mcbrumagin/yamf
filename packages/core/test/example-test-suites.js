import {
  // all assertion functions expect a value or function
  // and then any number of anonymous assertion functions
  // this permits multiple simultaneous assertions in the test report

  assert, // sync; expects a value or function
  assertOn, // async; expects a test function
  assertErr, // sync; expects a test function that should throw
  assertErrOn, // async; expects a test function that should throw

  MultiAssertError, // custom multiple-error object/stack for assert fns
  sleep, // in ms
  terminateAfter, // expects a registry, any number of services/routes, and a meta-test function (usually assert)
  runTests // expects an array of test fns; each is successful if no errors are thrown 
} from './core/index.js' // or wherever test/core/index.js is located

import { TestRunner } from './core/suite-runner.js'
// see base project README for more details on micro-js core functionality
import {
  registryServer,
  createRoute,
  createService,
  callService,
  HttpError,
  overrideConsoleGlobally
} from '../src/index.js'

overrideConsoleGlobally({
  includeLogLineNumbers: true
})


// --- Sync Assert Usage ---

// the runner will print this function name as the test case
function basicAssertTest() {
  assert(1, r => r === 1)
}

// using anonymous single-expression functions, still gets the name
const basicAnonymousAssertTest = () => assert(2, r => r === 2)

// use "assert" for synchronous tests
function basicSyncAssertTest() {
  assert(3, r => r === 3)
}

function basicAssertErrTest() {
  assertErr(new Error('test'), e => e.message === 'test')
}

function basicFailingAssertTest() {
  assert(1, r => r === 2) // prints your anonymous assert function in full
}

function basicFailingMultiAssertTest() {
  assert(1,
    r => r === 2,
    r => r === 3
  ) // prints both failures!
}

function basicFailingMultiAssertErrTest() {
  assertErr(new Error('test'),
    e => e.message === 'test', // doesn't print this
    e => e.message === 'test2' // not true, so prints
  )
}


// --- Async Assert Usage ---

async function basicAsyncAssertTest() {
  await assertOn(async () => 4, r => r === 4)
}

async function basicAsyncAssertErrTest() {
  await assertErrOn(async () => new Error('test'), e => e.message === 'test')
}


// very useful function that we will create services with...
async function customService({ isUseful }) {
  if (!isUseful) throw new HttpError(400, 'nah, this is a useful service')
  return `wow this is such a useful service: ${isUseful}`
}


// use the terminateAfter helper for service tests
async function customServiceTest() {
  // arrange
  await terminateAfter(
    // always do your registry first
    await registryServer(), // terminates after the test function
    await createService(customService), // this terminates too
    () => assertOn(

      // act
      async () => await callService('customService', { isUseful: true }),

      // multi-assert on callService result
      result => result.includes('wow'),
      result => result.includes('useful'),
      result => result.includes('true')
    )
  )
}

// setup services in parallel before running the test function
async function customServiceTestParallel() {
  // arrange
  await terminateAfter(
    // no need for await
    registryServer(),
    createService(customService),

    // this last argument must ALWAYS be a function
    // this prevents races and helps maintain a promise chain
    () => assertOn(

      // act - assertOn will handle async/await for us
      () => callService('customService', { isUseful: true }),
      // assert
      r => r.includes('wow'),
      r => r.includes('useful'),
      r => r.includes('true')
    )
  )
}

// this is my personal favorite pattern
async function customServiceTestAlternative() {
  await terminateAfter(
    registryServer(),
    createService(customService),
    async () => assert(await callService('customService', { isUseful: true }),
      r => r.includes('wow'),
      r => r.includes('useful'),
      r => r.includes('true')
    )
  )
}

function customServiceTestAlternativeSpicy() {
  // no async needed
  // but return is necessary for the runner to wait for terminateAfter
  // not recommended, but hey maybe you're spicy like that
  return terminateAfter(
    registryServer(),
    createService(customService),
    // implicit async/await pattern if you love arrow functions
    () => assertOn(() => callService('customService', { isUseful: true }),
      r => r.includes('wow'),
      r => r.includes('useful'),
      r => r.includes('true')
    )
  )
}

// if you're leery of implicit async/await
// or you need something safe, maintainable, portable, and easy to read
// use this pattern
async function customServiceTestRecommended() {
  await terminateAfter(
    registryServer(),
    createService(customService),
    async () => {

      // act within our test fn instead of our assert
      let result = await callService('customService', { isUseful: true })

      // this would be a great place to log a result
      // but maybe you don't need more logging? idk

      // explicit, conventional assert - classic!
      assert(result,
        r => r.includes('wow'),
        r => r.includes('useful'),
        r => r.includes('true')
      )
    }
  )
}


async function customServiceNegativeTest() {
  await terminateAfter(
    registryServer(),
    createService(customService),
    // terminateAfter passes the servers as arguments to the test function
    ([registry, service]) => assertErrOn(

      // act - assertErrOn requires a function to catch the error
      async () => await callService('customService', { isUseful: false }),

      // assert
      err => err.stack.includes('HttpClientError [400]'),
      err => err.message.includes('nah'),
      err => err.message.includes('this is a useful service')
      /* assertErr will automatically fail the test if no error is thrown */
    )
  )
}

async function customServiceFailingTest() {
  await terminateAfter(
    await registryServer(),
    await createService(customService),
    async () => {
      
      // null will break the customService (no default payload)
      let result = await callService('customService', null)

      assert(result,
        r => 'not gonna reach this though.. accessing isUseful from empty payload',
        r => 'if you want to see these failed assertions, fix the service call'
      )
    }
  )
}

// uncomment this in the testCases below to break the test runner
async function customServiceBadlyWrittenTest() {
  await terminateAfter(
    registryServer(),
    createService(customService),

    // act, but you did it wrong
    // the last terminateAfter argument is not a function
    assertOn(async () => await callService('customService', { isUseful: true }),
      // assert... never happens :'(
      r => 'not gonna reach this.. terminateAfter enforces a function as the last argument',
      r => 'the promise chain is broken',
      r => 'this will cause tests to exit early to prevent EADDRESSINUSE errors on subsequent tests',
      r => 'see these assertion errors by adding "() =>" before assert'
    )
  )
}

// TODO use import path as suite name... what to do for local suites like this?
let testRunner = new TestRunner()
testRunner.addSuite('customService', [
  customServiceTest,
  customServiceTestParallel,
  customServiceTestAlternative,
  customServiceTestAlternativeSpicy,
  customServiceTestRecommended,
  customServiceNegativeTest,
  customServiceFailingTest,
])

testRunner.run([
  // normal test registration
  basicAssertTest,
  basicAnonymousAssertTest,
  basicAsyncAssertTest,
  basicAssertErrTest,
  basicFailingAssertTest,
  basicFailingMultiAssertTest,
  basicFailingMultiAssertErrTest,

  // uncomment this to break the test runner
  // customServiceBadlyWrittenTest,
])
.then(() => process.exit(0))
.catch(err => {
  console.error(err.stack)
  process.exit(1)
})

/*
  The test runner defers printing error details until all tests are complete.
  No need to scroll back up... unless you need debug logs
*/
