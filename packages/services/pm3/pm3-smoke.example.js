/**
 * PM3 service: boot registry + factory with a temp managed path (no child processes).
 */
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pickListenPort } from '@yamf/test'
import { registryServer, envConfig } from '@yamf/core'
import createPm3Service from './service.js'

const port =
  process.env.YAMF_REGISTRY_URL != null && process.env.YAMF_REGISTRY_URL !== ''
    ? null
    : await pickListenPort()
const registryUrl =
  port != null ? `http://127.0.0.1:${port}` : process.env.YAMF_REGISTRY_URL
process.env.YAMF_REGISTRY_URL = registryUrl
envConfig.reloadFromProcessEnv()

const managed = mkdtempSync(join(tmpdir(), 'yamf-pm3-smoke-'))
await registryServer()
const srv = await createPm3Service({ managedServicePath: managed })
console.log('pm3 service:', srv.name, 'managed:', managed)
