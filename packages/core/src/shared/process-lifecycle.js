/**
 * Centralized process shutdown: one SIGINT/SIGTERM pair, ordered terminables.
 * Higher priority values run first (e.g. services 10, registry 0 last).
 */

import envConfig from './env-config.js'

const terminableEntries = new Set()
let installed = false
let shutdownInFlight = false

function install() {
  if (installed) return
  installed = true
  process.once('SIGTERM', () => { runShutdown('SIGTERM') })
  process.once('SIGINT', () => { runShutdown('SIGINT') })
}

/**
 * @param {() => void | Promise<void>} fn
 * @param {Object} [opts]
 * @param {number} [opts.priority=10] — higher runs first
 * @returns {() => void} call to unregister (e.g. before a manual `terminate()`)
 */
function registerTerminable(fn, { priority = 10 } = {}) {
  const entry = { fn, priority }
  terminableEntries.add(entry)
  install()
  return () => {
    terminableEntries.delete(entry)
  }
}

async function runShutdown(_reason) {
  if (shutdownInFlight) return
  shutdownInFlight = true
  const perTerminableMs = Number(envConfig.get('YAMF_GRACEFUL_SHUTDOWN_MS', 15000))
  const sorted = [...terminableEntries].sort((a, b) => b.priority - a.priority)
  for (const t of sorted) {
    let timer
    try {
      await Promise.race([
        Promise.resolve().then(() => t.fn()),
        new Promise((resolve) => { timer = setTimeout(resolve, perTerminableMs) })
      ])
    } catch {
      /* best effort */
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  terminableEntries.clear()
}

export const lifecycle = {
  registerTerminable
}
