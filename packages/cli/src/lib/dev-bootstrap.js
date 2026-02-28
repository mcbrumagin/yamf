#!/usr/bin/env node

/**
 * Dev environment bootstrap - started by `yamf init --dev`.
 * Launches registry + cache service + pm3-service in a single process.
 * This process is managed by pm3 itself (tagged as internal).
 */

import { registryServer, Logger } from '@yamf/core'

const logger = new Logger({ logGroup: 'yamf-dev' })

async function bootstrap() {
  const registry = await registryServer()
  logger.info('Registry running')

  let cacheService = null
  try {
    const { default: createCacheService } = await import('@yamf/services-cache')
    cacheService = await createCacheService({
      serviceName: 'pm3-cache',
      expireTime: 'None',
      evictionInterval: 'None'
    })
    logger.info('Cache service running')
  } catch {
    logger.warn('Cache service (@yamf/services-cache) not available — skipping')
  }

  let pm3Service = null
  try {
    const { default: createPm3Service } = await import('@yamf/services-pm3')
    pm3Service = await createPm3Service()
    logger.info('pm3-service running')
  } catch {
    logger.warn('pm3-service (@yamf/services-pm3) not available — skipping')
  }

  process.once('SIGTERM', async () => {
    logger.info('Shutting down dev environment...')
    try {
      if (pm3Service) await pm3Service.terminate()
      if (cacheService) await cacheService.terminate()
      await registry.terminate()
    } catch (err) {
      logger.error('Error during shutdown:', err)
    }
    process.exit(0)
  })

  process.once('SIGINT', async () => {
    logger.info('Shutting down dev environment...')
    try {
      if (pm3Service) await pm3Service.terminate()
      if (cacheService) await cacheService.terminate()
      await registry.terminate()
    } catch (err) {
      logger.error('Error during shutdown:', err)
    }
    process.exit(0)
  })
}

bootstrap().catch(err => {
  logger.error('Dev bootstrap failed:', err)
  process.exit(1)
})
