import Element from './element.js'
import elements from './elements.js'
import htmlTags from './html-tags.js'

import { 
  createState, 
  createReactiveComponent, 
  createFormState, 
  createRenderHelper,
  createDirectUpdater
} from './state.js'

import {
  beginListenerGeneration,
  patchDOM,
  sweepOrphanedYamfListeners
} from './patch-dom.js'

import {
  initializeYamf,
  getYamf
} from './client-init.js'

import { renderWithHandlers, runWithRenderContext, getRenderContext } from './ssr-render.js'
import { installSsrInvoke, installSsrRenderFromEventSource, serializeSsrEvent } from './ssr-hydrate.js'

import {
  waitForElement,
  isMobileBrowser,
  loadResource,
  router,
  hashRouter,
} from './client-utils.js'

// event-source.js uses node:http — NOT importable in browsers.
// Use `import { subscribeToEventSource } from '@yamf/client/event-source'` on the server instead.

// Import and re-export XSS utilities from shared for client convenience
import { 
  trusted, 
  isTrusted,
  encode,
  sanitize 
} from '@yamf/shared'

export { trusted, isTrusted, encode, sanitize }

// Named exports
export {
  Element,
  elements,
  htmlTags,
  createState,
  createReactiveComponent,
  createFormState,
  createRenderHelper,
  createDirectUpdater,
  beginListenerGeneration,
  patchDOM,
  sweepOrphanedYamfListeners,
  initializeYamf,
  getYamf,
  waitForElement,
  isMobileBrowser,
  loadResource,
  router,
  hashRouter,
  renderWithHandlers,
  runWithRenderContext,
  getRenderContext,
  installSsrInvoke,
  installSsrRenderFromEventSource,
  serializeSsrEvent
}

// Default export for backward compatibility
export default {
  Element,
  elements,
  htmlTags,
  createState,
  createReactiveComponent,
  createFormState,
  createRenderHelper,
  createDirectUpdater,
  beginListenerGeneration,
  patchDOM,
  sweepOrphanedYamfListeners,
  initializeYamf,
  getYamf,
  waitForElement,
  isMobileBrowser,
  loadResource,
  router,
  hashRouter,
  renderWithHandlers,
  runWithRenderContext,
  getRenderContext,
  installSsrInvoke,
  installSsrRenderFromEventSource,
  serializeSsrEvent,
  // XSS utilities
  trusted,
  isTrusted,
  encode,
  sanitize
}
