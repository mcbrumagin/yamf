/**
 * Registry + auth service with an inline password validator.
 * Set `YAMF_REGISTRY_URL` for a fixed port, or use the default below.
 */
import { registryServer } from '@yamf/core'
import createAuthService from './service.js'

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

await registryServer()

const svc = await createAuthService({
  validateUserPassword: async () => false,
  ephemeral: true
})
console.log('auth-service ready:', svc.name)
