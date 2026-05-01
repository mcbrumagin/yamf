import { httpRequest, buildAuthLoginHeaders } from '@yamf/core'

/**
 * Resolve a bearer token for registry-facing CLI commands.
 * @param {{ auth?: string|null, token?: string|null }} opts
 * @param {string} registryUrl
 * @returns {Promise<string|null>}
 */
export async function resolveCliRegistryToken (opts, registryUrl) {
  const auth = opts.auth ?? null
  const token = opts.token ?? null
  if (auth && token) {
    throw new Error('Use only one of --auth (user:pass) or --token (bearer)')
  }
  if (token) return token
  if (!auth) return null

  const colon = auth.indexOf(':')
  if (colon === -1) {
    throw new Error('--auth expects user:pass (colon-separated)')
  }
  const user = auth.slice(0, colon)
  const password = auth.slice(colon + 1)
  if (!user) {
    throw new Error('--auth expects non-empty user before ":"')
  }

  const result = await httpRequest(registryUrl, {
    headers: { ...buildAuthLoginHeaders() },
    body: { authenticate: { user, password } }
  })
  const bearer = result?.accessToken ?? result?.access_token ?? result?.token
  if (!bearer || typeof bearer !== 'string') {
    throw new Error('Auth login response did not include an access token')
  }
  return bearer
}
