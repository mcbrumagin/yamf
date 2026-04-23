/**
 * Per-render stack for SSR / isolated listener registration (concurrent-safe).
 */
const stack = []

/**
 * @param {object} ctx - Must include `registerHandler(fn) => { slot, signedId }` in SSR mode
 * @param {() => any} fn
 */
export function runWithRenderContext (ctx, fn) {
  stack.push(ctx)
  try {
    return fn()
  } finally {
    stack.pop()
  }
}

/**
 * @returns {object|undefined} Active render context
 */
export function getRenderContext () {
  return stack[stack.length - 1]
}
