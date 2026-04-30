/**
 * Registry + {@link import('../service.js').registerDeployRouter} integration: exercises the
 * `deploy-plan` and `deploy-bundle` plugin verbs against a real `registryServer`.
 */
import { createServer } from 'node:net'
import { assert, assertErr, sleep, terminateAfter, withEnv } from '@yamf/test'
import { registryServer, httpRequest, HEADERS } from '@yamf/core'
import { registerDeployRouter, DEPLOY_COMMANDS } from '../service.js'

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
    [HEADERS.COMMAND]: DEPLOY_COMMANDS.PLAN,
    ...extra
  }
}

const PLAN_TEST_ENV = {
  MUTE_LOG_GROUP_OUTPUT: 'true',
  MUTE_SUCCESS_CASES: 'true',
  LOG_LEVEL: 'error',
  YAMF_GRACEFUL_SHUTDOWN_MS: '2000',
  YAMF_DEPLOY_TOKEN: ''
}

export async function testRegisterDeployRouterPlanReturnsDecisionsForEmptyReplicas () {
  const baseUrl = await reserveRegistryBaseUrl()
  await withEnv({ ...PLAN_TEST_ENV, YAMF_REGISTRY_URL: baseUrl }, async () => {
    await terminateAfter(async () => {
      const reg = await registryServer()
      const { pickNode: pick } = registerDeployRouter(reg, { location: baseUrl })
      await sleep(200)

      const out = await httpRequest(baseUrl, {
        method: 'POST',
        headers: deployPlanHeaders(),
        body: { services: [{ name: 'deploy-router-int-svc', hash: 'sha256-abc', replicas: 1 }] }
      })

      await assert(out,
        o => o?.decisions?.length === 1,
        o => o.decisions[0].decision === 'rollout',
        o => o.decisions[0].service === 'deploy-router-int-svc',
        o => o.decisions[0].hash === 'sha256-abc'
      )
      // assert() invokes a function first arg as a thunk — pickNode needs pm3 locations and would
      // throw `no-placement` here. Compare on `typeof` instead.
      await assert(typeof pick, t => t === 'function')
    })
  })
}

export async function testRegisterDeployRouterPlanRejectsServiceMissingHash () {
  const baseUrl = await reserveRegistryBaseUrl()
  await withEnv({ ...PLAN_TEST_ENV, YAMF_REGISTRY_URL: baseUrl }, async () => {
    await terminateAfter(async () => {
      const reg = await registryServer()
      registerDeployRouter(reg, { location: baseUrl })
      await sleep(200)

      await assertErr(
        () => httpRequest(baseUrl, {
          method: 'POST',
          headers: deployPlanHeaders(),
          body: { services: [{ name: 'only-name' }] }
        }),
        e => e.status === 400,
        e => /name and hash/i.test(e.message || '')
      )
    })
  })
}

export async function testRegisterDeployRouterRejectsLegacyAttachName () {
  // The old `attachDeployRouter` export is gone; importing it must fail at module-load time.
  await assertErr(
    async () => {
      const mod = await import('../service.js')
      if (typeof mod.attachDeployRouter !== 'function') {
        throw new Error('attachDeployRouter has been renamed to registerDeployRouter')
      }
    },
    e => e.message.includes('renamed to registerDeployRouter')
  )
}

export async function testRegisterDeployRouterThrowsWithoutLocation () {
  await assertErr(
    () => registerDeployRouter({ _bundleStore: {} }, {}),
    e => e.message.includes('location'),
    e => e.message.includes('required')
  )
}

export async function testRegisterDeployRouterThrowsWithoutBundleStore () {
  const fakeRegistry = {
    registerCommand () {},
    getReplicasFor () { return [] },
    _state: { replicaMetadata: new Map() }
  }
  await assertErr(
    () => registerDeployRouter(fakeRegistry, { location: 'http://x' }),
    e => e.message.includes('bundle store') || e.message.includes('bundleStore')
  )
}

export async function testDeployCommandsConstantsAreFrozen () {
  await assert(DEPLOY_COMMANDS,
    c => c.PLAN === 'deploy-plan',
    c => c.BUNDLE === 'deploy-bundle',
    c => Object.isFrozen(c)
  )
}
