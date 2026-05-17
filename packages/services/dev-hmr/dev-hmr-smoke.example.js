/**
 * Dev HMR service: when YAMF_DEV is on, boots registry + SSE service; otherwise explains skip.
 */
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pickListenPort } from '@yamf/test'
import { registryServer, envConfig, envTruthy } from '@yamf/core'
import createDevHmrService from './service.js'

const port =
  process.env.YAMF_REGISTRY_URL != null && process.env.YAMF_REGISTRY_URL !== ''
    ? null
    : await pickListenPort()
const registryUrl =
  port != null ? `http://127.0.0.1:${port}` : process.env.YAMF_REGISTRY_URL
process.env.YAMF_REGISTRY_URL = registryUrl
envConfig.reloadFromProcessEnv()

if (!envTruthy(envConfig.get('YAMF_DEV', false)) || process.env.NODE_ENV === 'production') {
  console.log('dev-hmr smoke: skipped (set YAMF_DEV=true and non-production NODE_ENV to boot service)')
  process.exit(0)
}

const prevHome = process.env.YAMF_HOME
process.env.YAMF_HOME = mkdtempSync(join(tmpdir(), 'yamf-dev-hmr-smoke-'))
envConfig.reloadFromProcessEnv()
try {
  await registryServer()
  const srv = await createDevHmrService({ serviceName: 'yamf-dev-smoke' })
  if (!srv) {
    console.error('createDevHmrService returned null unexpectedly')
    process.exit(1)
  }
  console.log('dev-hmr service:', srv.name ?? srv.serviceName, srv.location ?? '')
} finally {
  if (prevHome === undefined) delete process.env.YAMF_HOME
  else process.env.YAMF_HOME = prevHome
}
