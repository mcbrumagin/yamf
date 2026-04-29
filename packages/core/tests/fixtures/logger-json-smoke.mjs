/**
 * Used by logger-format-tests.js — prints one JSON log line to stdout.
 */
process.env.LOG_JSON = 'true'
process.env.LOG_LEVEL = 'info'
process.env.DISABLE_ALL_CUSTOM_LOGS = ''
process.env.LOG_INCLUDE_LINES = ''
process.env.MUTE_LOG_GROUP_OUTPUT = ''

const { default: Logger } = await import('../../src/utils/logger.js')

const log = new Logger({ logGroup: 'fmt-json' }, 'info')
log.info('ping-json')
