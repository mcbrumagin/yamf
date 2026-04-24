import {
  deployDecisionFromReplicas,
  HEADERS,
  HttpError,
  publishMessage,
  streamBundleToFileWithHashCheck
} from '@yamf/core'
import { existsSync } from 'node:fs'
import { pickNode } from './placement.js'

const PLUGIN_SERVICE = 'yamf-deploy-router'

/**
 * @param {object} registry - server from `registryServer()`; must expose `registerCommand`, `getReplicasFor`, optional `_bundleStore`
 * @param {{ bundleStore?: object, location: string, pm3ServiceName?: string }} options
 * @param {string} options.location - own URL (used for `registerCommand` cleanup key; often `YAMF_REGISTRY_URL`)
 */
export function attachDeployRouter (registry, { bundleStore, location, pm3ServiceName = 'pm3-service' } = {}) {
  if (!location) {
    throw new Error('attachDeployRouter: `location` (registry public URL) is required')
  }
  if (!bundleStore && !registry?._bundleStore) {
    throw new Error('attachDeployRouter: pass bundleStore or start registry with a bundle store')
  }
  const store = bundleStore || registry._bundleStore

  // Server-side plan (auth: deploy token). The `yamf deploy` CLI still uses REGISTRY_PULL + planAndApply
  // client-side for parity; keep this for HTTP API consumers and future "registry as source of truth" flows.
  registry.registerCommand(
    'deploy-plan',
    async ({ body, headers }) => {
      const out = { decisions: [] }
      for (const s of body?.services || []) {
        if (!s?.name || !s?.hash) {
          throw new HttpError(400, 'Each service needs name and hash')
        }
        const reps = registry.getReplicasFor(s.name) || []
        const { decision } = deployDecisionFromReplicas(reps, s.hash, s.replicas ?? 1)
        out.decisions.push({ service: s.name, hash: s.hash, decision })
        const fromH = (reps || []).map((r) => r.sourceHash).filter(Boolean).join(',') || null
        try {
          await publishMessage('yamf:deploy', {
            service: s.name,
            fromHash: fromH,
            toHash: s.hash,
            decision,
            at: Date.now(),
            deployer: headers[HEADERS.DEPLOYER] || null
          })
        } catch {
          /* no pub */
        }
      }
      return out
    },
    {
      service: PLUGIN_SERVICE,
      location,
      requireDeployToken: true,
      requireRegistryToken: false,
      parseJsonBody: true
    }
  )

  registry.registerCommand(
    'deploy-bundle',
    async ({ request, headers }) => {
      const hash = (headers[HEADERS.DEPLOY_HASH] || headers['yamf-deploy-hash'] || '').trim()
      if (!hash) {
        throw new HttpError(400, 'yamf-deploy-hash required')
      }
      const out = store.pathFor(hash)
      if (existsSync(out)) {
        return { stored: hash, deduped: true }
      }
      try {
        await streamBundleToFileWithHashCheck(request, hash, out)
      } catch (e) {
        if (e?.code === 'BUNDLE_HASH_MISMATCH' || e?.status === 422) {
          const err = new HttpError(422, e.message || 'bundle-hash-mismatch')
          err.code = 'bundle-hash-mismatch'
          throw err
        }
        throw e
      }
      return { stored: hash }
    },
    {
      service: PLUGIN_SERVICE,
      location,
      requireDeployToken: true,
      requireRegistryToken: false,
      parseJsonBody: false
    }
  )

  return { pickNode: (o) => pickNode(registry, pm3ServiceName, o) }
}
