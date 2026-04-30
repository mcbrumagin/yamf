/**
 * Minimal registry + service round-trip. Tunables: set `YAMF_REGISTRY_URL` before running,
 * or rely on the default port below for local playground use.
 */
import { registryServer, createService, callService } from '@yamf/core'

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

await registryServer()

await createService(function exampleEcho (p) {
  return { ok: true, p }
})

const result = await callService('exampleEcho', { n: 42 })
console.log('callService result:', result)
