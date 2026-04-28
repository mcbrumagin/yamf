import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * @typedef {Object} YamfConfigService
 * @property {string} name
 * @property {string} entry
 * @property {string} [replicaKey] - a {@code createService} name in the entry (e.g. {@code 'cache-service'}) so REGISTRY_PULL
 *   {@code replicas[replicaKey]} and {@code pm3.restartRolling} can find the process. Defaults to {@code name}
 *   (yamf service id must then match a registered service name; often false for monoliths).
 * @property {number} [replicas]
 * @property {boolean} [internal]
 * @property {string[]} [env] - required env *names* (not values)
 * @property {string[]} [watch] - Extra files/dirs to watch (paths relative to {@code root}) for
 *   `yamf dev` rebuilds. The entry’s directory is always watched; add siblings such as
 *   {@code 'src/lib'} when the service imports from outside the entry tree.
 */

/**
 * @typedef {Object} YamfConfig
 * @property {string} [root]
 * @property {YamfConfigService[]} [services]
 * @property {object} [build]
 * @property {string[]} [build.external]
 * @property {string} [build.target]
 * @property {boolean} [build.sourcemap]
 * @property {'external' | 'bundle'} [build.packages] - `external` (default): do not bundle `node_modules`
 *   (avoids CJS `require('buffer')` etc. when the output is ESM). `bundle`: one file (can break Smithy / AWS). With
 *   `external`, install all runtime dependencies under the project’s top-level `node_modules` (next to
 *   `yamf.config.js`); Node’s ESM resolver does not use `NODE_PATH` and will not use a nested `src/.../node_modules`
 *   when loading the bundle from `.yamf/build/…`.
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
