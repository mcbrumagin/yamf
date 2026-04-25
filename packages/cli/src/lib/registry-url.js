import { createServer } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getYamfHome } from './yamf-paths.js'

export const DEFAULT_LOCAL_REGISTRY_URL = 'http://127.0.0.1:20000'

function parseUrlOrNull (raw) {
  try {
    return new URL(String(raw))
  } catch {
    return null
  }
}

export function isLoopbackHost (host) {
  const h = String(host || '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

export function isLoopbackRegistryUrl (registryUrl) {
  const u = parseUrlOrNull(registryUrl)
  if (!u) return false
  return isLoopbackHost(u.hostname)
}

/**
 * @param {string} [cwd]
 * @returns {string|null}
 */
export function readPm3RegistryUrlFromState (cwd = process.cwd()) {
  const statePath = join(getYamfHome(cwd), 'pm3', 'state.json')
  if (!existsSync(statePath)) return null
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    const u = raw?.registryUrl
    if (!u || typeof u !== 'string') return null
    return u
  } catch {
    return null
  }
}

/**
 * Resolve local dev/init registry URL.
 * Priority: YAMF_REGISTRY_URL -> PM3 state (loopback only) -> default loopback URL.
 * @param {{ cwd?: string }} [opts]
 */
export function resolveLocalRegistryUrl ({ cwd = process.cwd() } = {}) {
  if (process.env.YAMF_REGISTRY_URL) {
    return { registryUrl: process.env.YAMF_REGISTRY_URL, source: 'env' }
  }
  const fromState = readPm3RegistryUrlFromState(cwd)
  if (fromState && isLoopbackRegistryUrl(fromState)) {
    return { registryUrl: fromState, source: 'pm3-state' }
  }
  return { registryUrl: DEFAULT_LOCAL_REGISTRY_URL, source: 'default' }
}

/**
 * For local bootstrap safety: check whether the configured host:port is on this machine and free.
 * @param {string} registryUrl
 * @returns {Promise<{ local: boolean, available?: boolean, reason?: string }>}
 */
export async function checkLocalRegistryBootstrapTarget (registryUrl) {
  const u = parseUrlOrNull(registryUrl)
  if (!u) {
    return { local: false, reason: 'invalid-url' }
  }
  if (!isLoopbackHost(u.hostname)) {
    return { local: false, reason: 'non-loopback-host' }
  }
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return { local: true, available: false, reason: 'invalid-port' }
  }
  const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname
  const available = await new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', (err) => {
      if (err?.code === 'EADDRINUSE') return resolve(false)
      resolve(false)
    })
    srv.listen({ host, port }, () => {
      srv.close(() => resolve(true))
    })
  })
  return { local: true, available, reason: available ? 'available' : 'port-in-use' }
}
