import { createService, envConfig, HttpError } from '@yamf/core'
import { join } from 'node:path'
import { createConfigStore } from './storage.js'

function defaultDataDir () {
  return join(envConfig.get('YAMF_HOME', join(process.cwd(), '.yamf')), 'config', 'data')
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.dataDir]
 * @param {string} [opts.serviceName='config-service']
 * @param {string} [opts.adminToken] - defaults to YAMF_CONFIG_ADMIN_TOKEN
 */
export default async function createConfigService (opts = {}) {
  const serviceName = opts.serviceName || 'config-service'
  const dataDir = opts.dataDir || defaultDataDir()
  const adminToken = opts.adminToken || envConfig.get('YAMF_CONFIG_ADMIN_TOKEN', '')

  const store = createConfigStore(dataDir)

  return createService(
    serviceName,
    async function configHandler (payload) {
      if (!payload || typeof payload !== 'object') {
        throw new HttpError(400, 'JSON body required')
      }
      const { command } = payload
      if (command === 'get') {
        const { service, env: envName } = payload
        if (!service || !envName) {
          throw new HttpError(400, 'get requires service, env')
        }
        const pack = store.get(String(service), String(envName))
        return { values: { ...pack.values }, version: pack.version }
      }
      if (command === 'list') {
        const { service, env: envName } = payload
        return { entries: store.list(service || null, envName || null) }
      }
      if (command === 'set') {
        const token = payload.adminToken || payload.token
        if (!adminToken || token !== adminToken) {
          throw new HttpError(401, 'admin token required for set')
        }
        const { service, env: envName, values, expectedVersion } = payload
        if (!service || !envName || !values || typeof values !== 'object') {
          throw new HttpError(400, 'set requires service, env, values')
        }
        const v = store.set(
          String(service),
          String(envName),
          values,
          expectedVersion
        )
        return { version: v }
      }
      if (command === 'delete') {
        const token = payload.adminToken || payload.token
        if (!adminToken || token !== adminToken) {
          throw new HttpError(401, 'admin token required for delete')
        }
        const { service, env: envName, keys, expectedVersion } = payload
        if (!service || !envName || !keys) {
          throw new HttpError(400, 'delete requires service, env, keys (array of key names)')
        }
        const list = Array.isArray(keys) ? keys.map((k) => String(k)) : [String(keys)]
        if (list.length === 0) {
          throw new HttpError(400, 'delete requires at least one key name')
        }
        const v = store.removeKeys(
          String(service),
          String(envName),
          list,
          expectedVersion
        )
        return { version: v }
      }
      throw new HttpError(400, `Unknown command: ${command}`)
    },
    { accessControl: 'private' }
  )
}
