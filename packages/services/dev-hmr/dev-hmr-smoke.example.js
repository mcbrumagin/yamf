/**
 * Dev HMR service factory (see `service.js` for options).
 */
const mod = await import('./service.js')
console.log('createDevHmrService:', typeof mod.default)
