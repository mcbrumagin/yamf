/**
 * Integration tests: real registry + {@link import('../service.js') createPm3Service} + SERVICE_CALL
 * (Tier 1 of docs/TEST-PLAN-UNDER-50.md).
 */
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assert, assertErr, sleep, terminateAfter, withEnv } from '@yamf/test'
import { registryServer, callService } from '@yamf/core'
import createPm3Service from '../service.js'

/**
 * @returns {Promise<string>} e.g. `http://127.0.0.1:45678` (free port)
 */
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

function makePm3TestEnv (registryBaseUrl, yamfHome) {
  return {
    YAMF_REGISTRY_URL: registryBaseUrl,
    YAMF_HOME: yamfHome,
    MUTE_LOG_GROUP_OUTPUT: 'true',
    MUTE_SUCCESS_CASES: 'true',
    LOG_LEVEL: 'error',
    YAMF_GRACEFUL_SHUTDOWN_MS: '2000',
    YAMF_PM3_STOP_GRACE_MS: '2000',
    YAMF_PM3_REGISTRY_CHECK_ATTEMPTS: '6',
    YAMF_PM3_REGISTRY_CHECK_MS: '50',
    YAMF_PM3_POLL_INTERVAL_MS: '100',
    YAMF_PM3_POLL_STABLE_CHECKS: '2',
    // Avoid inheriting a deploy token from the developer shell for the list test
    YAMF_DEPLOY_TOKEN: ''
  }
}

export async function testPm3ServiceListIsReachableViaCallService () {
  const yamfHome = mkdtempSync(join(tmpdir(), 'yamf-pm3-int-'))
  const managed = mkdtempSync(join(tmpdir(), 'yamf-pm3-managed-'))
  const baseUrl = await reserveRegistryBaseUrl()
  try {
    await withEnv(makePm3TestEnv(baseUrl, yamfHome), async () => {
      await terminateAfter(
        () => registryServer(),
        () => createPm3Service({ managedServicePath: managed, serviceName: 'pm3-service' }),
        async () => {
          await sleep(600)
          const res = await callService('pm3-service', { command: 'list' })
          await assert(res, (r) => Array.isArray(r))
        }
      )
    })
  } finally {
    for (const d of [yamfHome, managed]) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch { /* */ }
    }
  }
}

export async function testPm3ServiceDeployRequiresDeployTokenWhenEnforced () {
  const yamfHome = mkdtempSync(join(tmpdir(), 'yamf-pm3-int-'))
  const managed = mkdtempSync(join(tmpdir(), 'yamf-pm3-managed-'))
  const baseUrl = await reserveRegistryBaseUrl()
  try {
    const env = { ...makePm3TestEnv(baseUrl, yamfHome), YAMF_DEPLOY_TOKEN: 'test-deploy-secret' }
    await withEnv(env, async () => {
      await terminateAfter(
        () => registryServer(),
        () => createPm3Service({ managedServicePath: managed, serviceName: 'pm3-service' }),
        async () => {
          await sleep(600)
          await assertErr(
            () =>
              callService('pm3-service', {
                command: 'deploy',
                service: 'pm3-it-svc',
                hash: 'sha256-missingok',
                env: {}
              }),
            (err) =>
              (err && err.status === 401) ||
              (err?.message && err.message.toLowerCase().includes('deploy token'))
          )
        }
      )
    })
  } finally {
    for (const d of [yamfHome, managed]) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch { /* */ }
    }
  }
}

export async function testPm3ServiceRejectsEmptyPayload () {
  const yamfHome = mkdtempSync(join(tmpdir(), 'yamf-pm3-int-'))
  const managed = mkdtempSync(join(tmpdir(), 'yamf-pm3-managed-'))
  const baseUrl = await reserveRegistryBaseUrl()
  try {
    await withEnv(makePm3TestEnv(baseUrl, yamfHome), async () => {
      await terminateAfter(
        () => registryServer(),
        () => createPm3Service({ managedServicePath: managed, serviceName: 'pm3-service' }),
        async () => {
          await sleep(600)
          await assertErr(
            () => callService('pm3-service', {}),
            (err) => err?.status === 400 || (err?.message && err.message.includes('command'))
          )
        }
      )
    })
  } finally {
    for (const d of [yamfHome, managed]) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch { /* */ }
    }
  }
}
