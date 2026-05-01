import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * @typedef {Object} YamfConfigService
 * @property {string} name
 * @property {string} entry
 * @property {string} [registeredServiceName] - Service name as registered in the bundle (`createService('…')`)
 *   when it differs from manifest {@code name}. Drives REGISTRY_PULL {@code replicas[registeredServiceName]}
 *   and local rolling restart resolution. Defaults to {@code name} at call sites when unset.
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
 * Strip legacy `replicaKey` and fold into `registeredServiceName` (Slice 8).
 * @param {YamfConfig & { _path?: string }} c
 * @returns {YamfConfig & { _path?: string }}
 */
function normalizeLoadedConfig (c) {
  if (!c || typeof c !== 'object') return c
  if (!Array.isArray(c.services) || c.services.length === 0) return { ...c }
  const services = c.services.map((s) => {
    if (!s || typeof s !== 'object') return s
    const legacy = s.replicaKey
    const next = { ...s }
    delete next.replicaKey
    const reg = s.registeredServiceName ?? legacy
    if (reg != null && reg !== '') {
      next.registeredServiceName = String(reg)
    } else {
      delete next.registeredServiceName
    }
    return next
  })
  return { ...c, services }
}

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
    return normalizeLoadedConfig({ root: '.', services: [], build: {}, ...c, _path: p })
  }
  return null
}
