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
  return context.yamf
}
