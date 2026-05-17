/**
 * Start local registry + cache + pm3-service (dev-bootstrap) when the registry URL is not yet reachable.
 * Used by `yamf dev` and by test harnesses (replacing removed `yamf init --dev`).
 */

import { httpRequest, HEADERS, COMMANDS } from '@yamf/core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkLocalRegistryBootstrapTarget } from './registry-url.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const DEV_BOOTSTRAP_PATH = join(__dirname, 'dev-bootstrap.js')

export async function isRegistryReachable (registryUrl) {
  try {
    await httpRequest(registryUrl, {
      headers: {
        [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
        ...(process.env.YAMF_REGISTRY_TOKEN
          ? { [HEADERS.REGISTRY_TOKEN]: process.env.YAMF_REGISTRY_TOKEN }
          : {})
      }
    })
    return true
  } catch {
    return false
  }
}

/** After dev-bootstrap (or on cold start), ensure REGISTRY_PULL succeeds before build/deploy. */
export async function waitUntilDevRegistryResponds (registryUrl) {
  const step = 200
  const maxMs = Number(process.env.YAMF_DEV_REGISTRY_READY_MS || 20_000)
  const n = Math.ceil(maxMs / step)
  for (let i = 0; i < n; i++) {
    if (await isRegistryReachable(registryUrl)) {
      if (i > 0) {
        process.stdout.write(
          `[dev] Registry at ${registryUrl} is ready (after ~${(i + 1) * step}ms).\n`
        )
      }
      return
    }
    if (i === 0) {
      process.stdout.write(`[dev] Waiting for registry at ${registryUrl}…\n`)
    }
    await new Promise((r) => setTimeout(r, step))
  }
  throw new Error(
    `[dev] Registry at ${registryUrl} is not accepting requests after ${maxMs}ms. ` +
      'Check $YAMF_HOME/pm3/logs/dev-bootstrap.log. If YAMF_REGISTRY_TOKEN is set, REGISTRY_PULL requires that header (isRegistryReachable sends it).'
  )
}

/**
 * If the registry is not responding, start dev-bootstrap on the given PM3 instance and wait until ready.
 * @param {import('./pm3.js').PM3} pm3
 * @param {string} registryUrl
 * @param {{ yamfDev?: boolean }} [opts]
 */
export async function ensureLocalDevStack (pm3, registryUrl, { yamfDev = false } = {}) {
  if (await isRegistryReachable(registryUrl)) return

  const probe = await checkLocalRegistryBootstrapTarget(registryUrl)
  if (!probe.local) {
    throw new Error(
      `[dev] Registry URL "${registryUrl}" is not loopback, so yamf cannot auto-start local dev-bootstrap for it. ` +
        'Set YAMF_REGISTRY_URL to a local URL (for example http://127.0.0.1:20000), or start that remote registry yourself.'
    )
  }
  if (probe.available === false) {
    throw new Error(
      `[dev] ${registryUrl} is not responding and the port is already in use. ` +
        'Likely orphan process or wrong service on that port. Run `yamf clean` (or stop the holder), then retry.'
    )
  }

  await pm3.start(DEV_BOOTSTRAP_PATH, {
    env: {
      YAMF_REGISTRY_URL: registryUrl,
      ...(yamfDev ? { YAMF_DEV: 'true' } : {})
    }
  })
  await waitUntilDevRegistryResponds(registryUrl)
}
