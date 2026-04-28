/**
 * HMAC-signed SSR handler slot registry (per SSE service, in-process).
 * Format: v1.<base64url(jsonPayload)>.<base64url(hmac)>
 * Payload: { slot, exp, kid, service }
 */
import crypto from 'node:crypto'
import envConfig from '../shared/env-config.js'

const DEFAULT_TTL_MS = 600000
const DEFAULT_MAX = 10000
const DEFAULT_SWEEP_MS = 60000
const V = '1'

function b64u (buf) {
  return Buffer.isBuffer(buf) ? buf.toString('base64url') : Buffer.from(String(buf), 'utf8').toString('base64url')
}
function b64uDecode (s) {
  return Buffer.from(s, 'base64url')
}

function getHmacSecret (serviceName) {
  const explicit = envConfig.get('YAMF_SSR_HANDLER_SECRET')
  if (explicit) {
    return Buffer.from(String(explicit), 'utf8')
  }
  return crypto
    .createHash('sha256')
    .update(
      `yamf:ssr:${envConfig.get('YAMF_REGISTRY_TOKEN', 'dev')}:${serviceName}`,
      'utf8'
    )
    .digest()
}

function buildPayload (slot, exp, serviceName) {
  return { slot, exp, kid: 'k0', service: serviceName }
}

/**
 * @param {string} serviceName
 */
export function createSsrHandlerRegistry (serviceName) {
  const ttlMs = Number(envConfig.get('YAMF_SSR_HANDLER_TTL_MS', String(DEFAULT_TTL_MS)))
  const maxEntries = Number(envConfig.get('YAMF_SSR_HANDLER_MAX', String(DEFAULT_MAX)))
  const sweepMs = Number(envConfig.get('YAMF_SSR_HANDLER_SWEEP_MS', String(DEFAULT_SWEEP_MS)))
  const secret = getHmacSecret(serviceName)

  /** @type {Map<string, { fn: Function, exp: number, touch: number }>} */
  const slots = new Map()
  let slotNext = 1
  let touchSeq = 0
  const kid = 'k0'

  function sign (slot, exp) {
    const body = buildPayload(slot, exp, serviceName)
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const h = crypto.createHmac('sha256', secret).update(payload).digest()
    return `v${V}.${b64u(payload)}.${b64u(h)}`
  }

  function verifyId (id) {
    if (!id || typeof id !== 'string' || !id.startsWith('v1.')) return null
    const parts = id.split('.')
    if (parts.length !== 3) return null
    const payload = b64uDecode(parts[1])
    const sig = b64uDecode(parts[2])
    const h = crypto.createHmac('sha256', secret).update(payload).digest()
    if (h.length !== sig.length || !crypto.timingSafeEqual(h, sig)) return null
    let body
    try {
      body = JSON.parse(payload.toString('utf8'))
    } catch {
      return null
    }
    if (body.service !== serviceName) return null
    if (body.kid !== kid) return null
    if (typeof body.exp === 'number' && body.exp < Date.now()) return null
    if (typeof body.slot !== 'string') return null
    return body
  }

  function evictLruIfNeeded () {
    while (slots.size >= maxEntries) {
      const keys = Array.from(slots.keys())
      let oldest = keys[0]
      let minTouch = slots.get(oldest).touch
      for (const k of keys) {
        const t = slots.get(k).touch
        if (t < minTouch) {
          minTouch = t
          oldest = k
        }
      }
      slots.delete(oldest)
    }
  }

  function registerHandler (fn) {
    if (typeof fn !== 'function') throw new Error('SSR handler must be a function')
    evictLruIfNeeded()
    const slot = String(slotNext++)
    const exp = Date.now() + ttlMs
    slots.set(slot, { fn, exp, touch: ++touchSeq })
    const signedId = sign(slot, exp)
    return { slot, signedId }
  }

  function getBindings () {
    return { registerHandler }
  }

  function sweep () {
    const now = Date.now()
    for (const [k, v] of slots) {
      if (v.exp < now) slots.delete(k)
    }
  }

  let sweepTimer = setInterval(sweep, sweepMs)
  sweepTimer.unref?.()

  function stopSweep () {
    if (sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }

  function sanitizeEvent (e) {
    if (e == null) return {}
    if (typeof e !== 'object' || Array.isArray(e)) return { type: 'unknown' }
    const o = e
    return {
      type: o.type,
      targetSel: o.targetSel,
      value: o.value,
      checked: o.checked,
      keyCode: o.keyCode,
      dataset: o.dataset
    }
  }

  function normalizeResult (result) {
    if (result == null) return { status: 204, body: null }
    if (typeof result === 'object' && result !== null && 'patch' in result && 'target' in result) {
      return { status: 200, body: { patch: result.patch, target: result.target } }
    }
    if (result && typeof result === 'object' && typeof result.render === 'function') {
      const html = result.render()
      const target =
        (result.attributes && (result.attributes['data-yamf-target'] || result.attributes['dataYamfTarget'])) || '#__yamf_root'
      return { status: 200, body: { patch: html, target } }
    }
    return { status: 200, body: result }
  }

  /**
   * @param {object} p - { id, event? }
   * @param {object} context - service this context
   */
  async function invoke (p, context) {
    if (!p || !p.id) {
      return { status: 400, body: { error: 'id required' } }
    }
    const body = verifyId(p.id)
    if (!body) {
      return { status: 410, body: { refresh: true, reason: 'invalid_or_expired' } }
    }
    const rec = slots.get(body.slot)
    if (!rec || rec.exp < Date.now()) {
      if (rec) slots.delete(body.slot)
      return { status: 410, body: { refresh: true, reason: 'slot_missing' } }
    }
    rec.touch = ++touchSeq
    let r
    try {
      r = await rec.fn.call(context, sanitizeEvent(p.event))
    } catch (err) {
      return { status: 500, body: { error: err?.message || String(err) } }
    }
    return normalizeResult(r)
  }

  return {
    serviceName,
    getBindings,
    registerHandler,
    verifyId,
    invoke,
    destroy: () => { stopSweep(); slots.clear() },
    /** @internal for tests */
    _slots: slots
  }
}
