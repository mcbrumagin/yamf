var context
if (typeof window !== "undefined") {
  context = window
} else context = {}

/**
 * Initialize the YAMF client global object
 * Provides a namespace for client-side utilities and components
 */
export function initializeYamf() {
  if (context.yamf) return context.yamf

  context.yamf = {
    __listeners__: {},
    /** @type {Record<string, { generation: number }>} */
    __listenerMeta__: {},
    /** Monotonic id for inline handler slots (avoids relying on Object key order). */
    __nextListenerId__: 1,
    __listenerGeneration__: 0,
    routes: {},
    modules: {}
  }

  return context.yamf
}

/**
 * Get the YAMF client global object
 * Initializes if not already present
 */
export function getYamf() {
  if (!context.yamf) {
    initializeYamf()
  }
  const y = context.yamf
  // Patch in fields that may be absent if yamf was initialized by an older version
  if (!y.__listenerMeta__) y.__listenerMeta__ = {}
  if (y.__nextListenerId__ == null) y.__nextListenerId__ = Object.keys(y.__listeners__ || {}).length + 1
  if (y.__listenerGeneration__ == null) y.__listenerGeneration__ = 0
  return y
}
