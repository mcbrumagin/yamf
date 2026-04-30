/**
 * Smoke: register the deploy-router plugin onto a registry and round-trip a `deploy-plan`
 * request. Run with `yamf test --as-test -f deploy-router-smoke.example.js -d packages/services/deploy-router`.
 *
 * Exits cleanly under the orchestrator's SIGTERM (registry shutdown cascade).
 */
import { createServer } from 'node:net'
import { registryServer, httpRequest, HEADERS } from '@yamf/core'
import { registerDeployRouter, DEPLOY_COMMANDS } from './service.js'

function pickFreeBaseUrl () {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(err => err ? reject(err) : resolve(`http://127.0.0.1:${port}`))
    })
    s.on('error', reject)
  })
}

const baseUrl = await pickFreeBaseUrl()
process.env.YAMF_REGISTRY_URL = baseUrl
process.env.YAMF_DEPLOY_TOKEN ||= ''

const registry = await registryServer()
registerDeployRouter(registry, { location: baseUrl })

const plan = await httpRequest(baseUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    [HEADERS.COMMAND]: DEPLOY_COMMANDS.PLAN
  },
  body: { services: [{ name: 'smoke-svc', hash: 'sha256-smoke', replicas: 1 }] }
})

console.info('deploy-router smoke ok:', JSON.stringify(plan))
