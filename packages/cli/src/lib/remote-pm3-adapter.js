import { httpRequest, HEADERS, COMMANDS } from '@yamf/core'

/**
 * Duck-typed PM3 for {@link import('./deploy-driver.js').planAndApply} over `pm3-service` (slice C3).
 * @param {{ registryUrl: string, registryToken?: string }} p
 */
export function createRemotePm3 ({ registryUrl, registryToken = process.env.YAMF_REGISTRY_TOKEN || '' }) {
  const call = (payload) =>
    httpRequest(registryUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
        [HEADERS.SERVICE_NAME]: 'pm3-service',
        ...(registryToken ? { [HEADERS.REGISTRY_TOKEN]: registryToken } : {})
      },
      body: payload
    })

  return {
    start: (bundlePath, { env }) =>
      call({
        command: 'deploy',
        service: env.YAMF_SERVICE_NAME,
        hash: env.YAMF_SOURCE_HASH,
        env: { ...env, YAMF_BUNDLE_PATH: env.YAMF_BUNDLE_PATH || bundlePath }
      }),
    restartRolling: (service, { env }) =>
      call({
        command: 'rolling-deploy',
        service,
        hash: env.YAMF_SOURCE_HASH,
        env
      })
  }
}
