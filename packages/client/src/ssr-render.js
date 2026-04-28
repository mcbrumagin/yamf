/**
 * Isomorphic HTML fragment rendering with HMAC slot binding (server) + signed ids in markup.
 * Use with a bindings object from @yamf/core (createSsrHandlerRegistry) / SSE `server.ssr.getBindings()`.
 */
import { runWithRenderContext } from './render-context.js'

/**
 * Renders a tree with SSR signed handlers. The element must be created **while** a render
 * context is active, otherwise `onclick` is registered on the global `yamf.__listeners__`.
 * Pass a **factory** `() => new elements.Button({ onclick: ... }, 'x')` (recommended) or
 * a pre-constructed node only for markup without interactive handlers.
 *
 * @param {import('./Element.js').default | () => import('./Element.js').default} elementOrFactory
 * @param {{ registerHandler: (fn: Function) => { slot: string, signedId: string } }} bindings
 * @returns {{ html: string }}
 */
export function renderWithHandlers (elementOrFactory, bindings) {
  if (!bindings || typeof bindings.registerHandler !== 'function') {
    throw new Error('renderWithHandlers: bindings.registerHandler is required')
  }
  const ctx = { registerHandler: bindings.registerHandler }
  const html = runWithRenderContext(ctx, () => {
    const el = typeof elementOrFactory === 'function' ? elementOrFactory() : elementOrFactory
    if (!el || typeof el.render !== 'function') {
      throw new Error('renderWithHandlers: element must have a render() method')
    }
    return el.render()
  })
  return { html }
}

export { runWithRenderContext, getRenderContext } from './render-context.js'
