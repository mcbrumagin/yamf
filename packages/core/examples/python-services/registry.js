import { envConfig, registryServer } from '@yamf/core'

envConfig.set('YAMF_REGISTRY_URL', 'http://localhost:3000')
await registryServer().catch(err => console.error(err.stack))
