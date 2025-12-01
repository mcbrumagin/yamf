
// List of boolean HTML attributes that should be rendered without values
const booleanAttributes = new Set([
  'disabled', 'checked', 'selected', 'readonly', 'required',
  'autofocus', 'autoplay', 'controls', 'loop', 'muted',
  'multiple', 'hidden', 'open', 'reversed', 'scoped',
  'async', 'defer', 'ismap', 'novalidate', 'formnovalidate'
])

export default class Element {

  bindEventAttributes() {
    for (let attr in this.attributes) {
      if (/^on/i.test(attr) && typeof this.attributes[attr] === 'function') {
        this.addEventListener(attr, this.attributes[attr])
        delete this.attributes[attr]
      }
    }
  }

  constructor(...args) {
    if (typeof args[0] === 'object' && !(args[0] instanceof Element)) {
      this.attributes = args[0]
      this.__listeners__ = {} // TODO set-map?
      this.bindEventAttributes()
      args = args.slice(1)
    }
    this.children = args
    this.__stateBindings__ = new Map() // For state management integration
    this.__unwatchFunctions__ = [] // Cleanup functions for state watchers
  }

  addEventListener(eventName, handler) {
    // TODO if !yamf, this is server side and needs to be rendered as an additional script
    let lastHandlerName = Object.keys(yamf.__listeners__).slice(-1)[0]
    let handlerName = lastHandlerName ? Number(lastHandlerName.replace(/\_/ig,'')) : 0
    handlerName++
    this.__listeners__[handlerName] = eventName
    yamf.__listeners__[handlerName] = handler
  }

  renderListeners() {
    let events = {}

    for (let handlerName in this.__listeners__) {
      let eventName = this.__listeners__[handlerName]
      let domEventHandler = `yamf.__listeners__[${handlerName}](event)`
      if (events[eventName]) events[eventName].push(domEventHandler)
      else events[eventName] = [domEventHandler]
    }

    let domEventHandlerText = ''
    for (let event in events) {
      let domEventHandlers = events[event]
      domEventHandlerText += ` ${event}="${domEventHandlers.join(';')}"`
    }
    return domEventHandlerText
  }

  renderAttributes() {
    let attributes = ''
    for (let attrName in this.attributes) {
      let attrVal = this.attributes[attrName]
      
      // Skip rendering if value is explicitly false, null, or undefined
      if (attrVal === false || attrVal === null || attrVal === undefined) {
        continue
      }
      
      // For boolean attributes, render just the attribute name (no value)
      if (booleanAttributes.has(attrName.toLowerCase())) {
        // Only render if truthy
        if (attrVal) {
          attributes += ` ${attrName}`
        }
      } else {
        // For non-boolean attributes, render with value
        attributes += ` ${attrName}="${attrVal}"`
      }
    }
    return attributes
  }

  render() {
    let result = `<${this.tag}${this.renderAttributes()}${this.renderListeners()}>${
      this.children.map(elem => elem && elem.toString() || '').join('')
    }${this.isVoid ? '' : `</${this.tag}>`}`

    // TODO this is a bad hack... need actual dom change event listener to call this
    if (this.ready) setTimeout(this.ready, 20)

    return result
  }

  fromString() {
    throw new Error('Unimplemented')
  }

  toString() {
    return this.render()
  }

  fromDomNode() {
    throw new Error('Unimplemented')
  }

  toDomNode() {
    let rawHtmlString = this.render()
    let newNodeDom = new DOMParser().parseFromString(rawHtmlString, 'text/html')
    return newNodeDom.querySelector(this.tag)
  }

  onReady(fn) {
    this.ready = fn
    return this
  }

  /**
   * Bind this element to a state property for reactive updates
   * @param {Object} state - State object from createState()
   * @param {string} stateKey - Key in state to bind to
   * @param {string} [targetProp='textContent'] - Element property to update ('textContent', 'innerHTML', or attribute name)
   * @param {Function} [transform] - Optional transform function for the value
   */
  bindState(state, stateKey, targetProp = 'textContent', transform = null) {
    if (!state || typeof state.watch !== 'function') {
      throw new Error('Invalid state object. Must have a watch() method.')
    }

    // Store the binding for potential cleanup
    this.__stateBindings__.set(stateKey, { state, targetProp, transform })

    // Watch for state changes
    const unwatch = state.watch((stateData) => {
      let value = stateData[stateKey]
      
      if (transform && typeof transform === 'function') {
        value = transform(value, stateData)
      }

      // Update the element based on target property
      if (targetProp === 'textContent' || targetProp === 'innerHTML') {
        // For DOM updates (client-side)
        if (typeof document !== 'undefined') {
          const domElement = this.toDomNode()
          if (domElement) {
            domElement[targetProp] = value
          }
        }
        // For server-side rendering, we'll update children
        if (targetProp === 'textContent') {
          this.children = [String(value)]
        }
      } else {
        // Update attribute
        if (!this.attributes) this.attributes = {}
        this.attributes[targetProp] = value
      }
    })

    this.__unwatchFunctions__.push(unwatch)
    return this
  }

  /**
   * Bind element's text content to a computed state value
   * @param {Object} state - State object
   * @param {Function} computeFn - Function that computes the value from state
   */
  bindComputed(state, computeFn) {
    if (!state || typeof state.watch !== 'function') {
      throw new Error('Invalid state object. Must have a watch() method.')
    }

    const unwatch = state.watch((stateData) => {
      const value = computeFn(stateData)
      this.children = [String(value)]
    })

    this.__unwatchFunctions__.push(unwatch)
    return this
  }

  /**
   * Create a reactive version of this element that updates when state changes
   * @param {Object} state - State object
   * @param {Function} renderFn - Function that returns new element content based on state
   */
  reactive(state, renderFn) {
    if (!state || typeof state.watch !== 'function') {
      throw new Error('Invalid state object. Must have a watch() method.')
    }

    const unwatch = state.watch((stateData) => {
      const newContent = renderFn(stateData)
      if (Array.isArray(newContent)) {
        this.children = newContent
      } else if (newContent) {
        this.children = [newContent]
      }
    })

    this.__unwatchFunctions__.push(unwatch)
    return this
  }

  /**
   * Clean up all state bindings for this element
   */
  unbindState() {
    this.__unwatchFunctions__.forEach(unwatch => unwatch())
    this.__unwatchFunctions__ = []
    this.__stateBindings__.clear()
    return this
  }

  /**
   * Enhanced render method that supports state-bound elements
   */
  render() {
    // If we have state bindings, ensure they're up to date
    for (const [stateKey, binding] of this.__stateBindings__) {
      const { state, targetProp, transform } = binding
      let value = state.get(stateKey)
      
      if (transform && typeof transform === 'function') {
        value = transform(value, state.getAll())
      }

      if (targetProp === 'textContent') {
        this.children = [String(value)]
      } else if (targetProp !== 'innerHTML') {
        // Update attribute
        if (!this.attributes) this.attributes = {}
        this.attributes[targetProp] = value
      }
    }

    let result = `<${this.tag}${this.renderAttributes()}${this.renderListeners()}>${
      this.children.map(elem => elem && elem.toString() || '').join('')
    }${this.isVoid ? '' : `</${this.tag}>`}`

    // TODO this is a bad hack... need actual dom change event listener to call this
    if (this.ready) setTimeout(this.ready, 20)

    return result
  }
}
