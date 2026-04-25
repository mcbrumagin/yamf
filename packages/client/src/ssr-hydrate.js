/**
 * Browser helpers: install yamf.invoke for SSR round-tripping and apply render SSE patches.
 * Server tests call the HTTP API directly; this module is for real browsers.
 */
import { getYamf } from './client-init.js'
import { beginListenerGeneration, patchDOM } from './patch-dom.js'

/**
 * @param {Event} [e]
 * @returns {object} Wire-safe event summary
 */
export function serializeSsrEvent (e) {
  if (!e) return { type: 'click' }
  const t = e.target
  if (!t || typeof t !== 'object' || t.nodeType !== 1) {
    return { type: e.type || 'unknown' }
  }
  const el = t
  let targetSel = el.tagName ? el.tagName.toLowerCase() : 'unknown'
  if (el.id) targetSel = `#${el.id}`
  else if (el.getAttribute('data-yamf-target')) {
    targetSel = `[data-yamf-target="${String(el.getAttribute('data-yamf-target')).replace(/"/g, '')}"]`
  }
  return {
    type: e.type,
    targetSel,
    value: el.value,
    checked: el.checked,
    keyCode: e.keyCode,
    dataset: { ...(el.dataset || {}) }
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.endpoint] - default: meta name="yamf-ssr-endpoint" or same-origin path
 * @param {string} [opts.authToken] - yamf-auth-token for protected SSE
 * @param {string} [opts.registryToken] - yamf-registry-token if your gateway expects it
 * @param {() => string | null} [opts.getAuthToken] - async token
 */
export function installSsrInvoke (opts = {}) {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const yamf = getYamf()
  const prev = yamf.invoke
  const ssrInvoke = async function (signedId, event) {
    const endpoint = opts.endpoint || readMeta('yamf-ssr-endpoint') || window.location.pathname
    const headers = {
      'content-type': 'application/json',
      'yamf-command': 'ssr-invoke-handler',
      'accept': 'application/json',
      ...opts.extraHeaders
    }
    if (opts.registryToken) headers['yamf-registry-token'] = opts.registryToken
    const token = (typeof opts.getAuthToken === 'function' && opts.getAuthToken()) || opts.authToken
    if (token) headers['yamf-auth-token'] = token
    const res = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ id: signedId, event: serializeSsrEvent(event) }),
      headers
    })
    if (res.status === 204) return
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()
    if (res.status === 410) {
      if (data && data.refresh) window.location.reload()
      return
    }
    if (res.status >= 400) {
      if (globalThis.__yamfSsrError) {
        return globalThis.__yamfSsrError(data, res)
      }
      console.error('SSR invoke failed', res.status, data)
      return
    }
    if (data && data.patch != null) {
      const targetSel = data.target || 'body'
      const root = document.querySelector(targetSel) || document.body
      beginListenerGeneration()
      patchDOM(root, typeof data.patch === 'string' ? data.patch : String(data.patch), {})
    }
    return data
  }
  yamf.invoke = ssrInvoke
  return function uninstall () {
    if (yamf.invoke === ssrInvoke) {
      yamf.invoke = prev
    }
  }
}

/**
 * When using EventSource, wire `event: render` with { patch, target } JSON in data
 */
export function installSsrRenderFromEventSource (eventSource) {
  if (!eventSource || typeof eventSource.addEventListener !== 'function') return () => {}
  const handler = (ev) => {
    try {
      const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data
      if (data?.patch == null) return
      const targetSel = data.target || 'body'
      const root = document.querySelector(targetSel) || document.body
      if (!root) return
      beginListenerGeneration()
      if (typeof data.patch === 'string') {
        patchDOM(root, data.patch, {})
      }
    } catch (e) {
      console.error('ssr-hydrate render event', e)
    }
  }
  eventSource.addEventListener('render', handler)
  return () => {
    if (eventSource.removeEventListener) eventSource.removeEventListener('render', handler)
  }
}

function readMeta (name) {
  const m = document.querySelector(`meta[name="${name}"]`)
  return m?.getAttribute('content') || null
}
