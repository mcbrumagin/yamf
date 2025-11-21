import Element from './Element.js'
import elements from './elements.js'
import htmlTags from './html-tags.js'
import { 
  createState, 
  createReactiveComponent, 
  createFormState, 
  createRenderHelper 
} from './state.js'
// import loadClient from './loadClient.js'

// Named exports
export {
  Element,
  elements,
  htmlTags,
  createState,
  createReactiveComponent,
  createFormState,
  createRenderHelper,
  // loadClient
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
  // loadClient
}
