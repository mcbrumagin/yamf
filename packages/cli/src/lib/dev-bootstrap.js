#!/usr/bin/env node

/**
 * Dev environment bootstrap — launched by PM3 when `yamf dev` or tests start the local stack.
 * Launches registry + cache service + pm3-service in a single process.
 * This process is managed by pm3 itself (tagged as internal).
 */

import { registryServer, Logger, lifecycle, envConfig, envTruthy } from '@yamf/core'
import { DEFAULT_LOCAL_REGISTRY_URL } from './registry-url.js'

const logger = new Logger({ logGroup: 'yamf-dev' })

async function bootstrap() {
  const registry = await registryServer()
  logger.info('Registry running')

  try {
    const { registerDeployRouter, DEPLOY_COMMANDS } = await import('@yamf/services-deploy-router')
    const regUrl = process.env.YAMF_REGISTRY_URL || DEFAULT_LOCAL_REGISTRY_URL
    registerDeployRouter(registry, { location: regUrl, bundleStore: registry._bundleStore })
    logger.info(`Deploy router registered (${DEPLOY_COMMANDS.PLAN}, ${DEPLOY_COMMANDS.BUNDLE})`)
  } catch (err) {
    logger.warn('Deploy router not available —', err?.message || err)
  }

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

  if (envTruthy(envConfig.get('YAMF_DEV', false)) && process.env.NODE_ENV !== 'production') {
    try {
      const { default: createDevHmrService } = await import('@yamf/services-dev-hmr')
      const devHmr = await createDevHmrService()
      if (devHmr) logger.info('dev-hmr (SSE reload) running — yamf dev will publish to yamf:dev-reload')
    } catch (e) {
      logger.warn('dev-hmr (@yamf/services-dev-hmr) not available —', e?.message || e)
    }
  }

  // Registry is already on lifecycle (priority 0). Add app pieces before exit.
  if (pm3Service) {
    lifecycle.registerTerminable(
      async () => {
        logger.info('Shutting down pm3-service...')
        await pm3Service.terminate()
      },
      { priority: 12 }
    )
  }
  if (cacheService) {
    lifecycle.registerTerminable(
      async () => {
        logger.info('Shutting down cache service...')
        await cacheService.terminate()
      },
      { priority: 10 }
    )
  }
  lifecycle.registerTerminable(
    async () => {
      logger.info('Shutting down dev process...')
      process.exit(0)
    },
    { priority: -1 }
  )
}

bootstrap().catch(err => {
  logger.error('Dev bootstrap failed:', err)
  process.exit(1)
})
