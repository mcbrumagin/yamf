import Element from './Element.js'
import elements from './elements.js'
import htmlTags from './html-tags.js'
import { 
  createState, 
  createReactiveComponent, 
  createFormState, 
  createRenderHelper 
} from './state.js'
import {
  initializeYamf,
  getYamf
} from './client-init.js'
import {
  waitForElement,
  isMobileBrowser,
  loadResource,
  router,
  hashRouter
} from './client-utils.js'

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
  initializeYamf,
  getYamf,
  waitForElement,
  isMobileBrowser,
  loadResource,
  router,
  hashRouter
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
  initializeYamf,
  getYamf,
  waitForElement,
  isMobileBrowser,
  loadResource,
  router,
  hashRouter,
  // XSS utilities
  trusted,
  isTrusted,
  encode,
  sanitize
}
