import { PM3 } from './pm3.js'
import { ensureLocalDevStack } from './local-dev-stack.js'
import { envConfig } from '@yamf/core'

/**
 * Temporarily apply `env` onto `process.env`, start local dev-bootstrap if needed, then restore.
 *
 * Keys present with value **`undefined`** remove that variable from `process.env` for the
 * duration of the call (so `Object.keys({ ...process.env, FOO: undefined })` still lists `FOO`
 * and we can strip inherited secrets like `YAMF_REGISTRY_TOKEN` before PM3 spawns children).
 *
 * @param {import('node:process').ProcessEnv} env
 * @param {{ yamfDev?: boolean }} [opts]
 */
export async function runBootstrapWithEnv (env, opts = {}) {
  const keys = Object.keys(env)
  const prev = {}
  for (const k of keys) {
    prev[k] = process.env[k]
    const v = env[k]
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }
  envConfig.reloadFromProcessEnv()
  try {
    const pm3 = new PM3()
    const url = env.YAMF_REGISTRY_URL
    if (!url) throw new Error('runBootstrapWithEnv: YAMF_REGISTRY_URL missing')
    await ensureLocalDevStack(pm3, url, opts)
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
    envConfig.reloadFromProcessEnv()
  }
}
