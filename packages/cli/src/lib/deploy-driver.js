/**
 * Shared deploy planning (Phase 2 — local; later: same function for remote with a different pm3 adapter).
 *
 * Cross-cut 6 (dev/prod parity): keep decision logic here; only `registryUrl` / process transport should differ.
 */

import { httpRequest, HEADERS, COMMANDS, deployDecisionFromReplicas } from '@yamf/core'
import { readFileSync, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { getServiceBuildDir } from './yamf-paths.js'

/**
 * Stream local bundle to registry `deploy-bundle` (slice C3).
 * @param {{ registryUrl: string, hash: string, bundlePath: string, deployToken?: string }} p
 */
export async function uploadDeployBundleToRegistry ({ registryUrl, hash, bundlePath, deployToken = process.env.YAMF_DEPLOY_TOKEN || '' }) {
  if (!deployToken) {
    throw new Error('YAMF_DEPLOY_TOKEN is required to upload a bundle to the registry')
  }
  const base = String(registryUrl).replace(/\/$/, '')
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      [HEADERS.COMMAND]: 'deploy-bundle',
      [HEADERS.DEPLOY_TOKEN]: deployToken,
      [HEADERS.DEPLOY_HASH]: hash,
      'content-type': 'application/javascript; charset=utf-8'
    },
    body: createReadStream(bundlePath),
    // @ts-ignore Node stream upload
    duplex: 'half'
  })
  if (!res.ok) {
    const t = await res.text()
    let msg = t
    try {
      const j = JSON.parse(t)
      if (j?.message) msg = j.message
    } catch { /* */ }
    throw new Error(`Bundle upload failed: ${res.status} ${msg}`)
  }
  return res.json()
}

/**
 * Fetch config values for a service from config-service (optional).
 * @param {string} registryUrl
 * @param {string} registryToken
 * @param {string} serviceName
 * @param {string} envName
 * @returns {Promise<{ values: Record<string, string>, version: string }>}
 */
export async function fetchConfigOverlay ({ registryUrl, registryToken, serviceName, envName }) {
  const headers = {
    [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
    [HEADERS.SERVICE_NAME]: 'config-service',
    'content-type': 'application/json',
    ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
  }
  const body = {
    command: 'get',
    service: serviceName,
    env: envName
  }
  const resp = await httpRequest(registryUrl, { method: 'POST', headers, body })
  return {
    values: resp.values && typeof resp.values === 'object' ? resp.values : {},
    version: resp.version != null ? String(resp.version) : ''
  }
}

/**
 * Merge required env names: config-service first, then `process.env` for any still missing.
 * @param {string[]} requiredNames
 * @param {Record<string, string>} overlay
 */
export function mergeRequiredEnvFromProcess (requiredNames, overlay) {
  const out = { ...overlay }
  for (const k of requiredNames) {
    if (out[k] == null || out[k] === '') {
      if (process.env[k] != null && process.env[k] !== '') {
        out[k] = process.env[k]
      }
    }
  }
  return out
}

/**
 * @param {object} args
 * @param {import('./load-yamf-config.js').YamfConfigService} args.yamfService
 * @param {string} args.hash
 * @param {import('./pm3.js').PM3} args.pm3
 * @param {string} args.registryUrl
 * @param {string} [args.registryToken]
 * @param {string} [args.envTarget='local']
 * @param {number} [args.replicas]
 * @param {string} [args.cwd]
 * @param {boolean} [args.remote] - If true, stream bundle to registry before pm3; uses {@link createRemotePm3} transport.
 * @param {string} [args.deployToken]
 */
export async function planAndApply ({
  yamfService,
  hash,
  pm3,
  registryUrl,
  registryToken = process.env.YAMF_REGISTRY_TOKEN || '',
  envTarget = 'local',
  replicas: replicasOverride,
  cwd = process.cwd(),
  remote = false,
  deployToken = process.env.YAMF_DEPLOY_TOKEN || ''
}) {
  const pull = await httpRequest(registryUrl, {
    headers: {
      [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
      ...(registryToken && { [HEADERS.REGISTRY_TOKEN]: registryToken })
    }
  })
  const serviceName = yamfService.name
  const current = pull.replicas?.[serviceName] || []
  const wantReplicas = replicasOverride ?? yamfService.replicas ?? 1

  const { decision, sameHash } = deployDecisionFromReplicas(current, hash, wantReplicas)

  if (decision === 'noop') {
    return { decision, replicas: sameHash.length }
  }

  const bundlePath = join(getServiceBuildDir(serviceName, cwd), `${hash}.mjs`)
  try {
    readFileSync(bundlePath)
  } catch {
    throw new Error(
      `Bundle missing: ${bundlePath}. Run \`yamf build ${serviceName}\` first.`
    )
  }

  if (remote) {
    await uploadDeployBundleToRegistry({ registryUrl, hash, bundlePath, deployToken })
  }

  let env = {
    YAMF_SOURCE_HASH: hash,
    YAMF_BUNDLE_PATH: bundlePath,
    YAMF_SERVICE_NAME: serviceName
  }

  const required = yamfService.env || []
  if (required.length) {
    try {
      const { values, version } = await fetchConfigOverlay({
        registryUrl,
        registryToken,
        serviceName,
        envName: envTarget
      })
      Object.assign(env, mergeRequiredEnvFromProcess(required, values))
      if (version) env.YAMF_CONFIG_VERSION = version
    } catch (e) {
      Object.assign(env, mergeRequiredEnvFromProcess(required, {}))
      const missing = required.filter((k) => env[k] == null || env[k] === '')
      if (missing.length) {
        throw new Error(
          `Missing env for ${serviceName}: ${missing.join(', ')}. ` +
          `Set them in the shell or start config-service (see @yamf/services-config). Underlying: ${e.message}`
        )
      }
    }
  }

  if (decision === 'rollout' || decision === 'scale') {
    const want = wantReplicas - sameHash.length
    if (want <= 0) {
      return { decision: 'noop', replicas: sameHash.length }
    }
    for (let i = 0; i < want; i++) {
      await pm3.start(bundlePath, { env })
    }
    return { decision, added: want }
  }

  // rolling — pm3 must spawn the new bundle path, not the old mjs, while carrying env
  const result = await pm3.restartRolling(serviceName, { env, bundlePath })
  return { decision, replaced: result.replaced?.length ?? 0, pm3: result }
}
