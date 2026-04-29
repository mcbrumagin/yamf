/**
 * Plain logger line without bracket ISO timestamp (YAMF_LOG_TIMESTAMP=off).
 */
process.env.LOG_JSON = ''
process.env.LOG_LEVEL = 'info'
process.env.YAMF_LOG_TIMESTAMP = 'off'
process.env.DISABLE_ALL_CUSTOM_LOGS = ''
process.env.LOG_INCLUDE_LINES = ''
process.env.MUTE_LOG_GROUP_OUTPUT = 'true'

const { default: Logger } = await import('../../src/utils/logger.js')

const log = new Logger({ logGroup: '' }, 'info')
log.info('plain-no-ts')
