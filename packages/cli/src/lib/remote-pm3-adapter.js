import { httpRequest, HEADERS, COMMANDS } from '@yamf/core'

/**
 * @param {{ registryUrl: string, registryToken?: string, deployToken?: string, preferLocation?: string }} p
 * @param {Record<string, unknown>} payload
 */
function callPm3Service ({ registryUrl, registryToken = process.env.YAMF_REGISTRY_TOKEN || '', deployToken, preferLocation = process.env.YAMF_PM3_SERVICE_LOCATION || '' }, payload) {
  const useDeploy = payload?.command === 'deploy' || payload?.command === 'rolling-deploy'
  const tok = useDeploy ? (deployToken ?? process.env.YAMF_DEPLOY_TOKEN ?? '') : ''
  return httpRequest(registryUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
      [HEADERS.SERVICE_NAME]: 'pm3',
      ...(registryToken ? { [HEADERS.REGISTRY_TOKEN]: registryToken } : {}),
      ...(tok ? { [HEADERS.DEPLOY_TOKEN]: tok } : {}),
      ...(preferLocation ? { [HEADERS.SERVICE_PREFER_LOCATION]: preferLocation } : {})
    },
    body: payload
  })
}

/**
 * All pm3-service wire commands (CLI `--remote`). Does not use deploy / rolling-deploy.
 *
 * **Naming vs `createRemotePm3`:** `startFile` sends wire `command: 'start'` — run a script path
 * that already exists on the node. That is the same as local `PM3#start` / `yamf start ./app.js`.
 * The object returned by {@link createRemotePm3} also has a `start` function, but that one sends
 * `command: 'deploy'` (hash + env + optional bundle download on the node) for
 * `planAndApply` — it is *not* `startFile`. Use `startFile` for remote process start; use
 * `createRemotePm3` only for deploy/rolling.
 *
 * @param {{ registryUrl: string, registryToken?: string, preferLocation?: string }} p
 */
export function createRemotePm3Cli (p) {
  const c = (body) => callPm3Service(p, body)
  return {
    list: (options) => c({ command: 'list', options: options != null ? options : {} }),
    /**
     * Wire `start`: run `filepath` on the remote host (path must exist there).
     * @see createRemotePm3 for the different `start` (deploy) used by `yamf deploy --remote`.
     */
    startFile: (filepath, options) => c({ command: 'start', filepath, options }),
    stop: (filepath) => c({ command: 'stop', filepath }),
    restart: (filepath, options) => c({ command: 'restart', filepath, options }),
    /** {@link import('./pm3.js').PM3#restartRolling} on the node (service name or filepath on that host). */
    restartRollingOnNode: (target, options) => c({ command: 'restart-rolling', target, options }),
    status: (filepath) => c({ command: 'status', filepath }),
    /** @param {{ lines?: number }} [opts] */
    logs: (filepath, opts) => c({ command: 'logs', filepath, options: opts || {} }),
    delete: (filepath) => c({ command: 'delete', filepath })
  }
}

/**
 * duck-typed PM3 for {@link import('./deploy-driver.js').planAndApply} over `pm3-service` (C3).
 * Also includes {@link createRemotePm3Cli} fields (`startFile`, `list`, …) except the names
 * `start` / `restartRolling` here mean **deploy** and **rolling-deploy** (see deploy-driver).
 * @param {{ registryUrl: string, registryToken?: string, deployToken?: string, preferLocation?: string }} p
 */
export function createRemotePm3 ({
  registryUrl,
  registryToken = process.env.YAMF_REGISTRY_TOKEN || '',
  deployToken = process.env.YAMF_DEPLOY_TOKEN || '',
  preferLocation = process.env.YAMF_PM3_SERVICE_LOCATION || ''
} = {}) {
  const c = (body) => callPm3Service({ registryUrl, registryToken, deployToken, preferLocation }, body)
  return {
    ...createRemotePm3Cli({ registryUrl, registryToken, preferLocation }),
    start: (bundlePath, { env }) =>
      c({
        command: 'deploy',
        service: env.YAMF_SERVICE_NAME,
        hash: env.YAMF_SOURCE_HASH,
        env: { ...env, YAMF_BUNDLE_PATH: env.YAMF_BUNDLE_PATH || bundlePath }
      }),
    restartRolling: (service, { env }) =>
      c({
        command: 'rolling-deploy',
        service,
        hash: env.YAMF_SOURCE_HASH,
        env
      })
  }
}

/**
 * @throws {Error} if env var missing
 */
export function requireRegistryUrlForRemote () {
  const u = process.env.YAMF_REGISTRY_URL
  if (!u) {
    throw new Error('YAMF_REGISTRY_URL is required for --remote (registry used to reach pm3-service).')
  }
  return u
}
