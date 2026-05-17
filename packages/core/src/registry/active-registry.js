/**
 * Track in-process registry server instances created by {@link registryServer} so
 * {@link terminateActiveRegistryServers} can shut them down without holding references
 * (used by `terminateAfter(fn)` in @yamf/test).
 * @internal
 */

/** @type {Array<import('node:http').Server & { terminate?: function, isRegistry?: boolean }>} */
const stack = []

/**
 * @param {import('node:http').Server & { terminate?: function }} server
 */
export function registerActiveRegistryServer (server) {
  stack.push(server)
}

/**
 * @param {import('node:http').Server & { terminate?: function }} server
 */
export function unregisterActiveRegistryServer (server) {
  const i = stack.lastIndexOf(server)
  if (i >= 0) stack.splice(i, 1)
}

/**
 * Terminate all in-process registry servers still tracked (LIFO).
 * Best-effort; failures are swallowed unless callers wrap with logging.
 * @returns {Promise<void>}
 */
export async function terminateActiveRegistryServers () {
  while (stack.length > 0) {
    const s = stack[stack.length - 1]
    try {
      if (s && typeof s.terminate === 'function') {
        await s.terminate()
      } else {
        unregisterActiveRegistryServer(s)
      }
    } catch {
      unregisterActiveRegistryServer(s)
    }
  }
}
