/**
 * Pure decision table (Phase 2/3) — same logic as `planAndApply` in the CLI, usable server-side.
 *
 * Replicas with a **missing** `sourceHash` are treated as stale: they must be rolled (replaced),
 * not scaled past. Otherwise `yamf dev` sees `sameHash.length === 0` and `otherHash.length === 0`
 * and incorrectly chooses **scale**, spawning another process without removing the old one.
 *
 * @param {Array<{ sourceHash?: string, location: string, [k: string]: * }>} currentReplicas
 * @param {string} hash
 * @param {number} [wantReplicas=1]
 * @returns {{ decision: 'rollout' | 'scale' | 'rolling' | 'noop', sameHash: *[], otherHash: *[], current: *[], wantReplicas: number }}
 */
export function deployDecisionFromReplicas (currentReplicas, hash, wantReplicas = 1) {
  const current = currentReplicas || []
  const sameHash = current.filter((r) => r.sourceHash === hash)
  /** Not the target hash, including missing / null / undefined (use strict equality on match only). */
  const otherHash = current.filter((r) => r.sourceHash !== hash)
  const decision =
    current.length === 0 ? 'rollout'
      : otherHash.length > 0 ? 'rolling'
        : sameHash.length < wantReplicas ? 'scale'
          : 'noop'
  return { decision, sameHash, otherHash, current, wantReplicas }
}
