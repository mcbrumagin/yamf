import {
  createService,
  Logger,
  HttpError,
  envConfig
} from '@yamf/core'
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

import { PM3 } from '@yamf/cli'

const logger = new Logger({ logGroup: 'pm3-service' })

/**
 * PM3 Service - network-facing process manager for yamf nodes.
 *
 * Can be deployed at a given YAMF_SERVICE_URL to enable remote CLI capabilities.
 * Wraps the pm3 library to expose start/stop/restart/list/status/logs over the wire.
 *
 * For now, this service is NOT recommended for production use.
 */
export default async function createPm3Service({
  serviceName = 'pm3-service',
  managedServicePath = '/tmp/yamf/services'
} = {}) {
  const pm3 = new PM3()

  const service = await createService(serviceName, async function (payload) {
    const { command, filepath, options } = payload || {}

    if (!command) {
      throw new HttpError(400, 'command is required (start, stop, restart, restart-rolling, list, status, logs, delete, deploy, rolling-deploy)')
    }

    switch (command) {
      case 'start': {
        if (!filepath) throw new HttpError(400, 'filepath is required for start')
        return pm3.start(filepath, options)
      }
      case 'stop': {
        if (!filepath) throw new HttpError(400, 'filepath is required for stop')
        return pm3.stop(filepath)
      }
      case 'restart': {
        if (!filepath) throw new HttpError(400, 'filepath is required for restart')
        return pm3.restart(filepath, options)
      }
      case 'restart-rolling': {
        const { target, options: rollOpts } = payload || {}
        if (!target) {
          throw new HttpError(400, 'target is required for restart-rolling (service name or filepath on this node)')
        }
        return pm3.restartRolling(target, rollOpts || {})
      }
      case 'list': {
        return pm3.list(options)
      }
      case 'status': {
        if (!filepath) throw new HttpError(400, 'filepath is required for status')
        return pm3.status(filepath)
      }
      case 'logs': {
        if (!filepath) throw new HttpError(400, 'filepath is required for logs')
        return pm3.logs(filepath, options || {})
      }
      case 'delete': {
        if (!filepath) throw new HttpError(400, 'filepath is required for delete')
        return pm3.delete(filepath)
      }
      case 'deploy': {
        const { service, hash, env: spawnEnv = {} } = payload || {}
        if (!hash) {
          throw new HttpError(400, 'hash is required (YAMF_SOURCE_HASH from deploy)')
        }
        mkdirSync(managedServicePath, { recursive: true })
        const bundlePath = join(managedServicePath, `${hash}.mjs`)
        if (!existsSync(bundlePath)) {
          const registryUrl = envConfig.get('YAMF_REGISTRY_URL', '')
          if (!registryUrl) {
            throw new HttpError(500, 'YAMF_REGISTRY_URL required to fetch bundle')
          }
          const base = registryUrl.replace(/\/$/, '')
          const u = new URL(`${base}/bundles/${String(hash).replace(/\.mjs$/, '')}`)
          const token = envConfig.get('YAMF_DEPLOY_TOKEN', '')
          const res = await fetch(u, { headers: { ...(token ? { 'yamf-deploy-token': token } : {}) } })
          if (!res.ok) {
            throw new HttpError(502, `bundle fetch failed: ${res.status}`)
          }
          const tmp = bundlePath + '.part'
          await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
          renameSync(tmp, bundlePath)
        }
        const nodeId = process.env.YAMF_SERVICE_URL || null
        return pm3.start(bundlePath, {
          env: {
            ...spawnEnv,
            YAMF_SOURCE_HASH: hash,
            YAMF_BUNDLE_PATH: bundlePath,
            ...(service ? { YAMF_SERVICE_NAME: service } : {}),
            ...(nodeId ? { YAMF_NODE_ID: nodeId } : {})
          }
        })
      }
      case 'rolling-deploy': {
        const { service, hash, env } = payload || {}
        if (!service) {
          throw new HttpError(400, 'service is required for rolling-deploy')
        }
        if (!hash) {
          throw new HttpError(400, 'hash is required for rolling-deploy')
        }
        const bundlePath = join(managedServicePath, `${hash}.mjs`)
        if (!existsSync(bundlePath)) {
          throw new HttpError(400, `Bundle not on disk: ${bundlePath}. Fetch the bundle on this node first.`)
        }
        return pm3.restartRolling(service, { env, bundlePath })
      }
      default:
        throw new HttpError(400, `Unknown command: ${command}. Valid: start, stop, restart, restart-rolling, list, status, logs, delete, deploy, rolling-deploy`)
    }
  })

  logger.info(`pm3-service ready (managed path: ${managedServicePath})`)
  return service
}
