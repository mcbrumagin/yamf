/**
 * D4: build an `applyPatch` for client SPAs that should **not** `location.reload()` on
 * Vite-originated `yamf:dev-reload` (`vite-plugin-yamf-dev` sets `source: 'vite'`), but
 * should still full-reload on `yamf dev` service redeploys (`source: 'yamf-dev'`, `service`, `hash`).
 *
 * @param {object} options
 * @param {() => void} options.onRerender — e.g. `() => pageComponent.update()` after Vite HMR has swapped modules
 * @param {(data: { service?: string, hash?: string, at?: number, source?: string }) => boolean} [options.preserveWhen]
 *   — return `true` to skip the default full reload. Default: `source === 'vite'` only.
 * @returns {(data: object) => (false|void)} suitable for {@link connectYamfDevHmr}
 */
export function createYamfDevHmrSpaPatch (options) {
  const { onRerender, preserveWhen = (d) => d?.source === 'vite' } = options
  if (typeof onRerender !== 'function') {
    throw new Error('createYamfDevHmrSpaPatch: onRerender is required')
  }
  return (data) => {
    if (preserveWhen(data)) {
      onRerender()
      return false
    }
  }
}

/**
 * Browser hook for {@link @yamf/services-dev-hmr}: connect to the `yamf-dev` SSE service and
 * react to `reload` events (ROADMAP Phase 4 D2). Safe to no-op when `url` is missing.
 *
 * D4: pass `applyPatch` for state‑preserving reloads. If the resolved value is strictly **`false`**, the default
 * `onReload` is skipped; any other return (including `undefined`) runs `onReload`.
 *
 * @param {object} [options]
 * @param {string} [options.url] — full base URL of the yamf-dev SSE service (e.g. from `SERVICE_LOOKUP` or `YAMF_GATEWAY_URL` + route)
 * @param {function(object): (void|boolean|Promise<boolean|void>)} [options.applyPatch] — receive `{ service, hash, at, source }` from the SSE payload
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
