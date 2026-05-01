/**
 * @param {*} state
 * @param {string} name
 * @returns {Array<{ location: string, sourceHash?: string, configVersion?: string, nodeId?: string, node?: string, registeredAt?: number }>}
 */
export function getReplicasFor (state, name) {
  const locs = state.services.get(name)
  if (!locs) return []
  return [...locs].map((loc) => {
    const k = `${name}\0${loc}`
    return { location: loc, ...(state.replicaMetadata.get(k) || {}) }
  })
}

/**
 * @param {*} state
 * @param {string} name
 * @returns {string[]}
 */
export function listServiceLocations (state, name) {
  const s = state.services.get(name)
  return s ? [...s] : []
}
