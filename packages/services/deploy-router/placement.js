import { HttpError } from '@yamf/core'

/**
 * C4: least-loaded pm3 node by `replicaMetadata.nodeId` tallies (legacy `node` still counted if present).
 * @param {{ _state?: { replicaMetadata: Map<unknown, { nodeId?: string, node?: string }> }, listHealthyLocations?: (name: string) => string[] }} registry
 * @param {string} pm3ServiceName
 * @param {{ excludeNodes?: string[] }} [opts]
 */
export function pickNode (registry, pm3ServiceName, { excludeNodes = [] } = {}) {
  const nodes = (registry.listHealthyLocations?.(pm3ServiceName) || [])
    .filter((n) => !excludeNodes.includes(n))
  if (!nodes.length) {
    throw new HttpError(503, 'no-placement')
  }
  const meta = registry._state?.replicaMetadata
  if (meta) {
    const load = new Map(nodes.map((n) => [n, 0]))
    for (const [, row] of meta) {
      const nid = row?.nodeId ?? row?.node
      if (nid && load.has(nid)) {
        load.set(nid, (load.get(nid) || 0) + 1)
      }
    }
    return [...load.entries()].sort((a, b) => a[1] - b[1])[0][0]
  }
  return nodes[0]
}
