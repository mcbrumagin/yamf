import {
  assert,
  assertErr
} from '@yamf/test'

import { Logger, envConfig } from '../../src/index.js'
const logger = new Logger()

export function testLoggerStringify() {
  let escape = 'escape test'
  let logObj = {a: 1, b: "2", d: true, e: null}
  let logFn = () => logger.log(`hey ${escape}`)
  let logStr = 'hello string'
  let logErr = new Error('test error')
  assert(
    logger.warn({logObj, logFn, logStr, logErr}),
    s => s.includes('a: 1,'),
    s => s.includes('b: "2",'),
    s => s.includes('d: true,'),
    s => s.includes('e: null,'),
    s => s.includes('`() => logger.log(\\`hey ${escape}\\`)`'),
    s => s.includes('"hello string"'),
    s => s.includes('`Error: test error')
  )
} 

export function testLoggerError() {
  assert(
    // regular assert since the logger doesn't throw this error
    () => logger.error(new Error('test error log fn')),
    res => res.includes('test error')
  )
}

export function testLoggerNoLevel() {
  // Test creating a logger with limited levels
  const testLogger = new Logger({}, 'info', ['info'])
  assert(
    testLogger.info('test'),
    s => s === undefined || s.includes('test')
  )
}

export function testLoggerColors() {
  let paintTestColor = color => logger.writeColor(color, ` ${color} |`)
  let paintTestColors = () => paintTestColor('white')
    + paintTestColor('green')
    + paintTestColor('magenta')
    + paintTestColor('red')
    + paintTestColor('blue')
    + paintTestColor('yellow')
    + paintTestColor('cyan')
    + paintTestColor('reset')

  assert(
    logger.info(paintTestColors()),
    s => s.includes('\x1b[31m'),
    s => s.includes('\x1b[32m'),
    s => s.includes('\x1b[33m'),
    s => s.includes('\x1b[34m'),
    s => s.includes('\x1b[35m'),
    s => s.includes('\x1b[36m'),
    s => s.includes('\x1b[0m'),
    s => s.includes('green'),
    s => s.includes('magenta'),
    s => s.includes('red'),
    s => s.includes('blue'),
    s => s.includes('yellow'),
    s => s.includes('cyan'),
    s => s.includes('reset')
  )
}

export function testLoggerDuplicateLevel() {
  assertErr(
    () => new Logger({}, null, ['info', 'info']),
    err => err.message.includes('Already created log fn for level info')
  )
}

export function testLoggerDepthLimit() {
  // Test default depth limit of 2
  let deepObj = {
    level0: {
      level1: {
        level2: {
          level3: 'too deep'
        }
      }
    }
  }
  
  let testLogger = new Logger()
  let result = testLogger.info(deepObj)
  
  assert(
    result,
    s => s.includes('level1'),
    s => s.includes('level2'),
    s => !s.includes('level3'),
    s => s.includes('[object depth limit reached]')
  )
}

export function testLoggerCustomDepthLimit() {
  // Test custom depth limit of 3
  let deepObj = {
    level0: {
      level1: {
        level2: {
          level3: {
            level4: 'too deep to see'
          }
        }
      }
    }
  }
  
  let testLogger = new Logger({ maxDepth: 3 })
  let result = testLogger.info(deepObj)
  
  assert(
    result,
    s => s.includes('level1'),
    s => s.includes('level2'),
    s => s.includes('level3'),
    s => !s.includes('level4'),
    s => s.includes('[object depth limit reached]')
  )
}

export function testLoggerDepthWarning() {
  // Test depth exceeded warning
  let deepObj = {
    level1: {
      level2: {
        level3: 'exceeded'
      }
    }
  }
  
  let testLogger = new Logger({ maxDepth: 1 })
  let result = testLogger.info(deepObj)
  
  assert(
    result,
    s => s.includes('level1'),
    s => s.includes('\x1b[33m'), // yellow color code
    s => s.includes('[object depth limit reached]')
  )
}

export function testLoggerEnvironmentConfig() {
  const originalEnv = envConfig.get('LOG_INCLUDE_LINES')
  
  envConfig.set('LOG_INCLUDE_LINES', true)
  let testLogger1 = new Logger({ warnLevel: false })
  assert(
    testLogger1.options.includeLogLineNumbers,
    val => val === true
  )
  
  envConfig.set('LOG_INCLUDE_LINES', false)
  let testLogger2 = new Logger({ warnLevel: false })
  assert(
    testLogger2.options.includeLogLineNumbers,
    val => val === false
  )

  envConfig.set('LOG_INCLUDE_LINES', originalEnv)
}
