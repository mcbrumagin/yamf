import {
  createService,
  Logger,
  HttpError
} from '@yamf/core'

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
      throw new HttpError(400, 'command is required (start, stop, restart, list, status, logs, delete)')
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
      case 'list': {
        return pm3.list(options)
      }
      case 'status': {
        if (!filepath) throw new HttpError(400, 'filepath is required for status')
        return pm3.status(filepath)
      }
      case 'logs': {
        if (!filepath) throw new HttpError(400, 'filepath is required for logs')
        return pm3.logs(filepath)
      }
      case 'delete': {
        if (!filepath) throw new HttpError(400, 'filepath is required for delete')
        return pm3.delete(filepath)
      }
      // future: 'deploy' command for receiving esbuild bundles
      default:
        throw new HttpError(400, `Unknown command: ${command}. Valid: start, stop, restart, list, status, logs, delete`)
    }
  })

  logger.info(`pm3-service ready (managed path: ${managedServicePath})`)
  return service
}
