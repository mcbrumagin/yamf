window.micro = {
  __listeners__: {},

  routes: {},

  // helper for internal library functions
  set library(fn) {
    if (!fn.name) throw new Error('Library must be a named function')
    this[fn.name] = fn
  },

  // convenience location for clients to avoid global namespace for elements/components
  modules: {},

  // convenience helper for module-like export syntax
  set exports(fn) {
    if (!fn.name) throw new Error('Exports must be a named function')
    this.modules[fn.name] = fn
  }
}
