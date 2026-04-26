/**
 * Cross-cut 2: compare service contracts for rolling / deploy gates.
 * "Backward compatible" here means: every payload that satisfied the *previous* (deployed) contract
 * is still valid under the *incoming* contract. Equivalently: the incoming service must not add
 * new required inputs that existing callers are allowed to omit.
 */

/**
 * @param {object|null|undefined} a
 * @param {object|null|undefined} b
 * @returns {boolean}
 */
export function areServiceContractsEqual (a, b) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return stableStringify(a) === stableStringify(b)
}

/**
 * @param {unknown} o
 * @returns {string}
 */
function stableStringify (o) {
  if (o === null || o === undefined) return JSON.stringify(o)
  if (typeof o !== 'object' || o instanceof RegExp) return JSON.stringify(String(o))
  if (Array.isArray(o)) return `[${o.map((x) => stableStringify(x)).join(',')}]`
  const keys = Object.keys(o).sort()
  return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(/** @type {Record<string, unknown>} */(o)[k])).join(',')}}`
}

/**
 * @param {object|null|undefined} prev
 * @param {object|null|undefined} next
 * @returns {boolean}
 */
export function isBackwardCompatibleServiceContract (prev, next) {
  if (next == null && prev == null) return true
  if (next == null) return false
  if (prev == null) return true
  if (areServiceContractsEqual(prev, next)) return true

  const pType = prev.contractType
  const nType = next.contractType
  if (pType && nType && pType !== nType) return false

  if (nType === 'validator' && pType === 'validator') {
    const a = JSON.stringify(prev.validatorSchema ?? null)
    const b = JSON.stringify(next.validatorSchema ?? null)
    if (a === b) return true
    const oKeys = new Set(Array.isArray(prev.expectedKeys) ? prev.expectedKeys : [])
    const nKeys = new Set(Array.isArray(next.expectedKeys) ? next.expectedKeys : [])
    for (const k of nKeys) {
      if (!oKeys.has(k)) return false
    }
    return oKeys.size >= 0
  }

  if (nType === 'validator' && pType !== 'validator') return false
  if (pType === 'validator' && nType !== 'validator') return false

  const oldKeys = new Set(Array.isArray(prev.expectedKeys) ? prev.expectedKeys : [])
  const newKeys = new Set(Array.isArray(next.expectedKeys) ? next.expectedKeys : [])
  for (const k of newKeys) {
    if (!oldKeys.has(k)) return false
  }
  return true
}

/**
 * @param {object|null|undefined} current
 * @param {object|null|undefined} incoming
 * @returns {{ summary: string, lines: string[], compatible: boolean }}
 */
export function diffServiceContracts (current, incoming) {
  if (areServiceContractsEqual(current, incoming)) {
    return { summary: 'unchanged', lines: ['Contract identical to previous.'], compatible: true }
  }
  if (current == null && incoming == null) {
    return { summary: 'none', lines: ['No contract (both sides).'], compatible: true }
  }
  if (current == null) {
    return { summary: 'new', lines: ['No prior service contract; incoming registers a new contract.'], compatible: true }
  }
  if (incoming == null) {
    return {
      summary: 'removed',
      lines: ['Incoming bundle has no service contract; registry currently has one. Treated as a breaking change unless --allow-breaking.'],
      compatible: false
    }
  }

  const lines = []
  const ok = isBackwardCompatibleServiceContract(current, incoming)
  const aKeys = new Set(Array.isArray(current.expectedKeys) ? current.expectedKeys : [])
  const bKeys = new Set(Array.isArray(incoming.expectedKeys) ? incoming.expectedKeys : [])
  for (const k of bKeys) {
    if (!aKeys.has(k)) {
      lines.push(`  + required key (new): ${k}`)
    }
  }
  for (const k of aKeys) {
    if (!bKeys.has(k)) {
      lines.push(`  - required key (relaxed in incoming): ${k}`)
    }
  }
  if (current.contractType !== incoming.contractType) {
    lines.push(`  ~ contractType: ${String(current.contractType)} → ${String(incoming.contractType)}`)
  }
  if (current.contractType === 'validator' && incoming.contractType === 'validator') {
    if (JSON.stringify(current.validatorSchema) !== JSON.stringify(incoming.validatorSchema)) {
      lines.push('  ~ validatorSchema changed (see detail if needed)')
    }
  }
  if (lines.length === 0) {
    lines.push('  (non-key contract fields may differ; run with verbose registry logging for full JSON.)')
  }

  return {
    summary: ok ? 'compatible (or relaxed)' : 'incompatible (stricter or changed type)',
    lines,
    compatible: ok
  }
}

/**
 * @param {object|null|undefined} current
 * @param {object|null|undefined} incoming
 * @param {{ allowBreaking: boolean }} opts
 * @returns {{ allowed: boolean, reason?: string, diff: ReturnType<typeof diffServiceContracts> }}
 */
export function checkDeployContractGate (current, incoming, { allowBreaking }) {
  const diff = diffServiceContracts(current, incoming)
  if (isBackwardCompatibleServiceContract(current, incoming) || areServiceContractsEqual(current, incoming)) {
    return { allowed: true, diff }
  }
  if (allowBreaking) {
    return { allowed: true, reason: 'allow-breaking overrides incompatible service contract change', diff }
  }
  return {
    allowed: false,
    reason: 'Service contract is not backward compatible with the version on the registry. Use yamf deploy --allow-breaking to override, or fix the contract.',
    diff
  }
}
