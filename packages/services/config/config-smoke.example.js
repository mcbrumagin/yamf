import { join } from 'node:path'
import { registryServer, callService } from '@yamf/core'
import createConfigService from './service.js'

// Required for encrypted config storage / admin API (example-only values).
process.env.YAMF_CONFIG_KEY = process.env.YAMF_CONFIG_KEY || 'example-config-passphrase-for-tests-only-32b!'
process.env.YAMF_CONFIG_ADMIN_TOKEN = process.env.YAMF_CONFIG_ADMIN_TOKEN || 'example-token-for-local-examples'

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

await registryServer()
await createConfigService({
  adminToken: process.env.YAMF_CONFIG_ADMIN_TOKEN,
  dataDir: join(process.cwd(), '.yamf-example-config-data')
})

const r = await callService('config-service', { command: 'list' })
console.log('config list:', r?.entries?.length ?? r)
