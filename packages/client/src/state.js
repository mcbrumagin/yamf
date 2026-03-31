/**
 * Reactive State Management Extension for @yamf/client
 * 
 * Provides a simple reactive state system with automatic re-rendering
 * when state changes. Designed to work seamlessly with @yamf/client components.
 * Includes foundation for future server-to-client event integration (WS/SSE).
 * 
 * Usage:
 *   const state = createState({ count: 0 })
 *   state.watch(() => renderComponent())
 *   state.set('count', state.get('count') + 1) // triggers re-render
 * 
 * Advanced Usage with Elements:
 *   const element = div().bindState(state, 'count')
 *   state.set('count', 42) // automatically updates element
 */

import { beginListenerGeneration, patchDOM, sweepOrphanedYamfListeners } from './patch-dom.js'

export function createState(initialState = {}) {
  const state = { ...initialState }
  const watchers = new Set()
  const computedCache = new Map()
  const computedDeps = new Map()

  return {
    /**
     * Get a value from state
     */
    get(key) {
      return state[key]
    },

    /**
     * Get all state
     */
    getAll() {
      return { ...state }
    },

    /**
     * Set a value in state and notify watchers
     */
    set(key, value) {
      const oldValue = state[key]
      if (oldValue !== value) {
        state[key] = value
        this.notify()
      }
    },

    /**
     * Update multiple values at once
     */
    update(updates) {
      let changed = false
      for (const [key, value] of Object.entries(updates)) {
        if (state[key] !== value) {
          state[key] = value
          changed = true
        }
      }
      if (changed) {
        this.notify()
      }
    },

    /**
     * Watch state changes (reactive subscription)
     * Returns an unwatch function
     */
    watch(callback) {
      watchers.add(callback)
      return () => watchers.delete(callback)
    },

    /**
     * Notify all watchers of state change
     */
    notify() {
      // Clear computed cache on state change
      computedCache.clear()
      
      watchers.forEach(callback => {
        try {
          callback(this.getAll())
        } catch (error) {
          console.error('State subscriber error:', error)
        }
      })
    },

    /**
     * Create a computed value that depends on state
     */
    computed(key, computeFn, dependencies = []) {
      computedDeps.set(key, dependencies)
      
      return () => {
        // Check if cached value is still valid
        if (computedCache.has(key)) {
          const deps = computedDeps.get(key)
          let valid = true
          
          for (const dep of deps) {
            if (state[dep] !== computedCache.get(key).deps[dep]) {
              valid = false
              break
            }
          }
          
          if (valid) {
            return computedCache.get(key).value
          }
        }
        
        // Compute new value
        const value = computeFn.call(this.getAll())
        const depValues = {}
        for (const dep of computedDeps.get(key)) {
          depValues[dep] = state[dep]
        }
        
        computedCache.set(key, { value, deps: depValues })
        return value
      }
    },

    /**
     * Create a derived state that automatically updates when dependencies change
     */
    derive(key, deriveFn, dependencies = []) {
      const derivedState = createState({ [key]: deriveFn(this.getAll()) })
      
      this.watch(() => {
        const newValue = deriveFn(this.getAll())
        if (derivedState.get(key) !== newValue) {
          derivedState.set(key, newValue)
        }
      })
      
      return derivedState
    },

    /**
     * Foundation for future server-to-client event integration
     * This will be expanded to support WebSocket/SSE connections
     */
    enableRemoteSync(options = {}) {
      const { endpoint, protocol = 'ws' } = options
      
      // Placeholder for future implementation
      console.warn('Remote sync not yet implemented. This is a placeholder for future WS/SSE integration.')
      
      return {
        disconnect: () => console.log('Remote sync disconnected'),
        isConnected: () => false,
        send: (data) => console.log('Would send:', data)
      }
    },

    /**
     * Batch multiple state updates to trigger only one notification
     */
    batch(updateFn) {
      const originalNotify = this.notify
      let shouldNotify = false
      
      // Temporarily override notify to track if changes occurred
      this.notify = () => { shouldNotify = true }
      
      try {
        updateFn(this)
      } finally {
        // Restore original notify and call it if changes occurred
        this.notify = originalNotify
        if (shouldNotify) {
          this.notify()
        }
      }
    }
  }
}


/**
 * @param {Object} state - State object from createState()
 * @param {Function} renderFn - Function that returns @yamf/client elements
 * @param {HTMLElement|string} container - DOM element or selector to render into
 * @returns {Object} Component controller with mount/unmount methods
 */
export function createReactiveComponent(state, renderFn, container) {
  let mounted = false
  let unwatch = null
  const containerEl = typeof container === 'string'
    ? document.querySelector(container)
    : container

  if (!containerEl) {
    throw new Error(`Container not found: ${container}`)
  }

  const render = () => {
    if (!mounted) return
    try {
      beginListenerGeneration()
      const element = renderFn(state.getAll())
      const html = element && element.render ? element.render() : (typeof element === 'string' ? element : '')
      patchDOM(containerEl, html)
    } catch (error) {
      console.error('Render error:', error)
    }
  }

  return {
    mount() {
      if (mounted) return
      mounted = true
      unwatch = state.watch(render)
      render()
    },
    unmount() {
      if (!mounted) return
      mounted = false
      if (unwatch) {
        unwatch()
        unwatch = null
      }
    },
    update() {
      render()
    },
  }
}


/**
 * Helper to create a form state manager with validation
 */
export function createFormState(initialValues = {}, validators = {}) {
  // TODO if we add CSRF protection, we need to add a token to the form state
  // NOTE it should not be needed since we are using JWT lite, but it would be good for defense in depth
  // will be ideal for financial/medical data, legacy browsers, or samesite relaxation
  const state = createState({ ...initialValues })
  const formState = createState({
    values: state,
    errors: {},
    touched: {},
    isSubmitting: false,
    isValid: true
  })

  return {
    // ...formState,
    ...state,

    setValue(field, value) {
      state.set(field, value)
      const values = { ...state.getAll(), [field]: value }
      formState.set('values', values)
      
      // Validate if field has been touched
      if (formState.get('touched')[field]) {
        this.validateField(field, value)
      }
    },

    setTouched(field) {
      const touched = { ...formState.get('touched'), [field]: true }
      formState.set('touched', touched)
      this.validateField(field, state.getAll()[field])
    },

    validateField(field, value) {
      const validator = validators[field]
      if (!validator) return true

      const error = validator(value, state.getAll())
      const errors = { ...formState.get('errors') }
      
      if (error) {
        errors[field] = error
      } else {
        delete errors[field]
      }
      
      formState.set('errors', errors)
      formState.set('isValid', Object.keys(errors).length === 0)
      
      return !error
    },

    validateAll() {
      const values = state.getAll()
      const errors = {}
      
      for (const [field, validator] of Object.entries(validators)) {
        const error = validator(values[field], values)
        if (error) {
          errors[field] = error
        }
      }
      
      formState.set('errors', errors)
      formState.set('isValid', Object.keys(errors).length === 0)
      
      return Object.keys(errors).length === 0
    },

    reset() {
      state.update({ ...initialValues })
      formState.update({
        values: state,
        errors: {},
        touched: {},
        isSubmitting: false,
        isValid: true
      })
    },

    setSubmitting(isSubmitting) {
      formState.set('isSubmitting', isSubmitting)
    }
  }
}

/**
 * Advanced render helper that integrates state management with @yamf/client elements
 * Provides automatic re-rendering, state binding, and performance optimizations
 */
export function createRenderHelper(container, initialRenderFn, options = {}) {
  const {
    debounceMs = 0,
    enableVirtualDOM = false,
    onError = err => { throw err },
  } = options

  let currentRenderFn = initialRenderFn
  let currentElement = null
  let renderTimeout = null
  let isRendering = false
  const stateBindings = new Map()

  const containerEl = typeof container === 'string' 
    ? document.querySelector(container)
    : container

  if (!containerEl) {
    throw new Error(`Container not found: ${container}`)
  }

  const debouncedRender = (state) => {
    if (renderTimeout) clearTimeout(renderTimeout)
    
    renderTimeout = setTimeout(() => {
      if (isRendering) return
      
      try {
        isRendering = true
        beginListenerGeneration()
        const newElement = currentRenderFn(state?.getAll?.() || {})
        
        if (newElement && newElement.render) {
          const newHTML = newElement.render()
          
          // Simple virtual DOM comparison (can be enhanced)
          if (enableVirtualDOM && currentElement) {
            const currentHTML = currentElement.render()
            if (currentHTML === newHTML) {
              sweepOrphanedYamfListeners()
              return // No changes, skip render (drop listener slots allocated this pass)
            }
          }
          
          patchDOM(containerEl, newHTML)
          currentElement = newElement
        } else if (typeof newElement === 'string') {
          patchDOM(containerEl, newElement)
        }
      } catch (error) {
        onError('Render error:', error)
      } finally {
        isRendering = false
      }
    }, debounceMs)
  }

  return {
    /**
     * Render a component with optional state binding
     */
    render(state = null) {
      if (state && state.watch) {
        const prev = stateBindings.get('watch')
        if (prev) prev()
        const unwatch = state.watch(() => debouncedRender(state))
        stateBindings.set('watch', unwatch)
      }
      
      // Initial render
      debouncedRender(state)
      
      return this
    },

    /**
     * Update the current render function
     */
    update(nextRenderFn, state = null) {
      for (const unwatch of stateBindings.values()) {
        unwatch()
      }
      stateBindings.clear()
      currentRenderFn = nextRenderFn
      return this.render(state)
    },

    /**
     * Clean up all state bindings and clear container
     */
    destroy() {
      if (renderTimeout) clearTimeout(renderTimeout)
      
      // Clean up all state bindings
      for (const unwatch of stateBindings.values()) {
        unwatch()
      }
      stateBindings.clear()
      
      if (typeof document !== 'undefined') {
        beginListenerGeneration()
        patchDOM(containerEl, '')
      }
      currentElement = null
    },

    /**
     * Get the current rendered element
     */
    getCurrentElement() {
      return currentElement
    }
  }
}

/**
 * Fast path: run updateFn per matching element. If it returns a string or Element
 * with .render(), that HTML is patched into the element via morphdom. If it returns
 * undefined, the callback is assumed to have mutated the DOM directly.
 *
 * @param {string} selector - passed to querySelectorAll
 * @param {(element: globalThis.HTMLElement, ...args: any[]) => any} updateFn
 * @returns {(...args: any[]) => void}
 */
export function createDirectUpdater(selector, updateFn) {
  return (...args) => {
    if (typeof document === 'undefined') return
    const nodes = document.querySelectorAll(selector)
    for (const el of nodes) {
      beginListenerGeneration()
      const out = updateFn(el, ...args)
      if (out !== undefined && out !== null) {
        const html = typeof out === 'object' && typeof out.render === 'function'
          ? out.render()
          : String(out)
        patchDOM(el, html)
      }
    }
  }
}
