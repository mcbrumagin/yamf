/**
 * Browser hook for {@link @yamf/services-dev-hmr}: connect to the `yamf-dev` SSE service and
 * react to `reload` events (ROADMAP Phase 4 D2). Safe to no-op when `url` is missing.
 *
 * D4: pass `applyPatch` for state‑preserving reloads; if it returns `false`, the default
 * `onReload` is skipped (e.g. you handled everything in the patch).
 *
 * @param {object} [options]
 * @param {string} [options.url] — full base URL of the yamf-dev SSE service (e.g. from `SERVICE_LOOKUP` or `YAMF_GATEWAY_URL` + route)
 * @param {function(object): (void|boolean|Promise<boolean|void>)} [options.applyPatch] — receive `{ service, hash, at, source }`
 * @param {function(): void} [options.onReload] — default `() => location.reload()`
 * @returns {function(): void} disconnect
 */
export function connectYamfDevHmr (options = {}) {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const { url, applyPatch, onReload = () => { window.location.reload() } } = options
  if (!url) {
    return () => {}
  }
  const es = new EventSource(url, { withCredentials: true })
  const onReloadEvent = (ev) => {
    let data = {}
    try {
      data = ev.data && JSON.parse(ev.data)
    } catch {
      data = {}
    }
    if (typeof applyPatch === 'function') {
      try {
        const r = applyPatch(data)
        Promise.resolve(r)
          .then((skipDefault) => {
            if (skipDefault !== false) onReload()
          })
          .catch(() => onReload())
      } catch {
        onReload()
      }
    } else {
      onReload()
    }
  }
  es.addEventListener('reload', onReloadEvent)
  return () => {
    es.removeEventListener('reload', onReloadEvent)
    es.close()
  }
}
