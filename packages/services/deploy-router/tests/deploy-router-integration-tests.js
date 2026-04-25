/**
 * Registry + {@link import('../service.js') attachDeployRouter} — `deploy-plan` plugin (Tier A iter 2).
 */
import { createServer } from 'node:net'
import { assert, assertErr, sleep, terminateAfter, withEnv } from '@yamf/test'
import { registryServer, httpRequest, HEADERS } from '@yamf/core'
import { attachDeployRouter } from '../service.js'

function reserveRegistryBaseUrl () {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close((err) => (err != null ? reject(err) : resolve(`http://127.0.0.1:${port}`)))
    })
    s.on('error', reject)
  })
}

function deployPlanHeaders (extra = {}) {
  return {
    'content-type': 'application/json',
    [HEADERS.COMMAND]: 'deploy-plan',
    ...extra
  }
}

export async function testAttachDeployRouterDeployPlanReturnsDecisionsForEmptyReplicas () {
  const baseUrl = await reserveRegistryBaseUrl()
  await withEnv(
    {
      YAMF_REGISTRY_URL: baseUrl,
      MUTE_LOG_GROUP_OUTPUT: 'true',
      MUTE_SUCCESS_CASES: 'true',
      LOG_LEVEL: 'error',
      YAMF_GRACEFUL_SHUTDOWN_MS: '2000',
      YAMF_DEPLOY_TOKEN: ''
    },
    async () => {
      await terminateAfter(
        () => registryServer(),
        async (reg) => {
          const { pickNode: pick } = attachDeployRouter(reg, { location: baseUrl })
          await sleep(200)
          const out = await httpRequest(baseUrl, {
            method: 'POST',
            headers: deployPlanHeaders(),
            body: {
              services: [
                { name: 'deploy-router-int-svc', hash: 'sha256-abc', replicas: 1 }
              ]
            }
          })
          await assert(out?.decisions?.length, (n) => n === 1)
          await assert(out.decisions[0].decision, (d) => d === 'rollout')
          await assert(out.decisions[0].service, (s) => s === 'deploy-router-int-svc')
          // assert() would invoke a function first argument; compare typeof without calling pick (needs pm3 locations).
          await assert(typeof pick, (t) => t === 'function')
        }
      )
    }
  )
}

export async function testAttachDeployRouterDeployPlanRejectsServiceMissingHash () {
  const baseUrl = await reserveRegistryBaseUrl()
  await withEnv(
    {
      YAMF_REGISTRY_URL: baseUrl,
      MUTE_LOG_GROUP_OUTPUT: 'true',
      LOG_LEVEL: 'error',
      YAMF_GRACEFUL_SHUTDOWN_MS: '2000',
      YAMF_DEPLOY_TOKEN: ''
    },
    async () => {
      await terminateAfter(
        () => registryServer(),
        async (reg) => {
          attachDeployRouter(reg, { location: baseUrl })
          await sleep(200)
          await assertErr(
            () =>
              httpRequest(baseUrl, {
                method: 'POST',
                headers: deployPlanHeaders(),
                body: { services: [{ name: 'only-name' }] }
              }),
            (e) => e.status === 400
          )
        }
      )
    }
  )
}

export async function testAttachThrowsWithoutLocation () {
  await assertErr(
    () => attachDeployRouter({ _bundleStore: {} }, {}),
    (e) => e && e.message && (e.message.includes('location') || e.message.includes('required'))
  )
}

export async function testAttachThrowsWithoutBundleStore () {
  const fake = {
    registerCommand () {},
    getReplicasFor () {
      return []
    },
    _state: { replicaMetadata: new Map() }
  }
  await assertErr(
    () => attachDeployRouter(fake, { location: 'http://x' }),
    (e) => e && e.message && e.message.includes('bundle store')
  )
}
