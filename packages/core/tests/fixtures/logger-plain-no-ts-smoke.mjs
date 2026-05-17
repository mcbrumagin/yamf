/**
 * Plain logger line without bracket ISO timestamp (YAMF_LOG_TIMESTAMP=off).
 */
process.env.LOG_JSON = ''
process.env.LOG_LEVEL = 'info'
process.env.YAMF_LOG_TIMESTAMP = 'off'
process.env.YAMF_LOG_DISABLE_CUSTOM = ''
process.env.LOG_INCLUDE_LINES = ''
process.env.YAMF_LOG_QUIET_GROUPS = 'true'

const { default: Logger } = await import('../../src/utils/logger.js')

const log = new Logger({ logGroup: '' }, 'info')
log.info('plain-no-ts')
