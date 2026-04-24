/**
 * Pure decision table (Phase 2/3) — same logic as `planAndApply` in the CLI, usable server-side.
 * @param {Array<{ sourceHash?: string, location: string, [k: string]: * }>} currentReplicas
 * @param {string} hash
 * @param {number} [wantReplicas=1]
 * @returns {{ decision: 'rollout' | 'scale' | 'rolling' | 'noop', sameHash: *[], otherHash: *[], wantReplicas: number }}
 */
export function deployDecisionFromReplicas (currentReplicas, hash, wantReplicas = 1) {
  const current = currentReplicas || []
  const sameHash = current.filter((r) => r.sourceHash === hash)
  const otherHash = current.filter((r) => r.sourceHash && r.sourceHash !== hash)
  const decision =
    current.length === 0 ? 'rollout'
      : otherHash.length > 0 ? 'rolling'
        : sameHash.length < wantReplicas ? 'scale'
          : 'noop'
  return { decision, sameHash, otherHash, current, wantReplicas }
}
