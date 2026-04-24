import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * @typedef {Object} YamfConfigService
 * @property {string} name
 * @property {string} entry
 * @property {number} [replicas]
 * @property {boolean} [internal]
 * @property {string[]} [env] - required env *names* (not values)
 */

/**
 * @typedef {Object} YamfConfig
 * @property {string} [root]
 * @property {YamfConfigService[]} [services]
 * @property {object} [build]
 * @property {string[]} [build.external]
 * @property {string} [build.target]
 * @property {boolean} [build.sourcemap]
 */

/**
 * @param {string} [cwd]
 * @returns {Promise<YamfConfig & { _path?: string } | null>}
 */
export async function loadYamfConfig (cwd = process.cwd()) {
  for (const name of ['yamf.config.js', 'yamf.config.mjs', 'yamf.config.cjs']) {
    const p = resolve(cwd, name)
    if (!existsSync(p)) continue
    const mod = await import(pathToFileURL(p).href)
    const c = mod.default || mod
    if (!c || typeof c !== 'object') {
      throw new Error(`${name} must export a default object`)
    }
    return { root: '.', services: [], build: {}, ...c, _path: p }
  }
  return null
}
