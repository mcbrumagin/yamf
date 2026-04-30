import {
  deployDecisionFromReplicas,
  HEADERS,
  HttpError,
  publishMessage,
  streamBundleToFileWithHashCheck,
  enforceDeployBundleEd25519Policy
} from '@yamf/core'
import { existsSync } from 'node:fs'
import { pickNode } from './placement.js'

/**
 * Wire verbs registered by {@link registerDeployRouter}. Exported so CLI / deploy-driver code
 * can target them without stringly-typed literals.
 */
export const DEPLOY_COMMANDS = Object.freeze({
  /** Server-side rollout decision; takes `{ services: [{ name, hash, replicas? }] }`. */
  PLAN: 'deploy-plan',
  /** Streamed bundle upload; body is the raw bundle, `yamf-deploy-hash` header required. */
  BUNDLE: 'deploy-bundle'
})

const PLUGIN_SERVICE = 'yamf-deploy-router'

/**
 * Install the deploy-router plugin onto a running registry.
 *
 * This is a **registry plugin** in the privileged in-process tier (see
 * `@yamf/core/registry/command-router.js#registerCommand`): handlers run with direct
 * `getReplicasFor` / `_bundleStore` access *after* token validation. It is **not** a
 * service factory and is reserved for trusted boot code (CLI dev bootstrap, integration
 * harnesses). For app-level extension via custom `yamf-command` verbs, see the v1 plan —
 * service-extended commands are deferred to post-v1.
 *
 * Verbs registered: {@link DEPLOY_COMMANDS.PLAN} and {@link DEPLOY_COMMANDS.BUNDLE}.
 *
 * @param {object} registry - server from `registryServer()`; must expose `registerCommand`,
 *   `getReplicasFor`, and (if `bundleStore` is omitted) `_bundleStore`.
 * @param {{ bundleStore?: object, location: string, pm3ServiceName?: string }} options
 * @param {string} options.location - Own URL (used as the `registerCommand` cleanup key;
 *   typically `YAMF_REGISTRY_URL`).
 * @returns {{ pickNode: (opts?: object) => string }} Helper bound to the registry / pm3 service name.
 */
export function registerDeployRouter (registry, { bundleStore, location, pm3ServiceName = 'pm3' } = {}) {
  if (!location) {
    throw new Error('registerDeployRouter: `location` (registry public URL) is required')
  }
  if (!bundleStore && !registry?._bundleStore) {
    throw new Error('registerDeployRouter: pass bundleStore or start registry with a bundle store')
  }
  const store = bundleStore || registry._bundleStore

  // Server-side plan (auth: deploy token). The `yamf deploy` CLI still uses REGISTRY_PULL +
  // planAndApply client-side for parity; this stays for HTTP API consumers and future
  // "registry as source of truth" flows.
  registry.registerCommand(
    DEPLOY_COMMANDS.PLAN,
    async ({ body, headers }) => {
      const out = { decisions: [] }
      for (const s of body?.services || []) {
        if (!s?.name || !s?.hash) {
          throw new HttpError(400, 'Each service needs name and hash')
        }
        const reps = registry.getReplicasFor(s.name) || []
        const { decision } = deployDecisionFromReplicas(reps, s.hash, s.replicas ?? 1)
        out.decisions.push({ service: s.name, hash: s.hash, decision })
        const fromHash = reps.map((r) => r.sourceHash).filter(Boolean).join(',') || null
        try {
          await publishMessage('yamf:deploy', {
            service: s.name,
            fromHash,
            toHash: s.hash,
            decision,
            at: Date.now(),
            deployer: headers[HEADERS.DEPLOYER] || null
          })
        } catch {
          // best-effort observability; missing pubsub does not fail the plan
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
    DEPLOY_COMMANDS.BUNDLE,
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
      const policy = enforceDeployBundleEd25519Policy({
        hash,
        headers: request?.headers || {}
      })
      if (policy && 'status' in policy) {
        throw new HttpError(policy.status, policy.message)
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
