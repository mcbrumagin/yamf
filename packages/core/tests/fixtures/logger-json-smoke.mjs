/**
 * Used by logger-format-tests.js — prints one JSON log line to stdout.
 */
process.env.LOG_JSON = 'true'
process.env.LOG_LEVEL = 'info'
process.env.YAMF_LOG_DISABLE_CUSTOM = ''
process.env.LOG_INCLUDE_LINES = ''
process.env.YAMF_LOG_QUIET_GROUPS = ''

const { default: Logger } = await import('../../src/utils/logger.js')

const log = new Logger({ logGroup: 'fmt-json' }, 'info')
log.info('ping-json')
