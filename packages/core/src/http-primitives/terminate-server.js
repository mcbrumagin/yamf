/**
 * Shared graceful-terminate logic for the HTTP servers created by
 * `http-server.js` and `http-proxy-server.js`.
 *
 * Why this exists:
 *   Both servers run with `keepAlive: true`. Node's `server.close()` only
 *   stops accepting new connections; it waits indefinitely for existing
 *   connections (including idle keep-alive sockets) to drain before
 *   emitting `'close'`. In the in-process cascade scenario (test process,
 *   `--as-test` examples, single-process integration runs) the same
 *   process holds undici keep-alive sockets pointed at this server, so
 *   `'close'` would never fire and the lifecycle cascade hangs.
 *
 *   The fix is to (a) immediately destroy idle keep-alive sockets via
 *   `closeIdleConnections()` and (b) force-close any still-active
 *   connections after a small grace window via `closeAllConnections()`,
 *   so `'close'` is guaranteed to fire.
 *
 * Tunables:
 *   - `YAMF_HTTP_FORCE_CLOSE_MS` (default `1000`): how long after `close()`
 *     to wait for active requests to finish before force-closing them.
 *     Set `0` to force immediately. Set very large to effectively disable
 *     the safety net (e.g. only graceful drain).
 */

import envConfig from '../shared/env-config.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const POST_CLOSE_SETTLE_MS = 5

/**
 * Attach a `terminate()` method to the given http.Server that closes the
 * server, immediately destroys idle keep-alive sockets, and force-closes
 * any remaining sockets after a grace window so `'close'` is guaranteed.
 *
 * @param {import('node:http').Server} server
 */
export function installTerminate (server) {
  server.terminate = () => new Promise((resolve) => {
    let forceTimer = null
    let resolved = false

    const finish = () => {
      if (resolved) return
      resolved = true
      if (forceTimer) {
        clearTimeout(forceTimer)
        forceTimer = null
      }
      // Brief settle so the OS releases the listener fully; preserves
      // the prior behavior that some tests relied on for re-bind safety.
      sleep(POST_CLOSE_SETTLE_MS).then(resolve)
    }

    server.on('close', finish)
    server.close()

    if (typeof server.closeIdleConnections === 'function') {
      try { server.closeIdleConnections() } catch { /* best effort */ }
    }

    const forceMs = Number(envConfig.get('YAMF_HTTP_FORCE_CLOSE_MS', 1000))
    if (forceMs >= 0 && typeof server.closeAllConnections === 'function') {
      forceTimer = setTimeout(() => {
        try { server.closeAllConnections() } catch { /* best effort */ }
      }, forceMs)
    }
  })
}
