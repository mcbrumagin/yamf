/**
 * `attachDeployRouter` is exported for gateway integration tests.
 */
const { attachDeployRouter } = await import('./service.js')
console.log('attachDeployRouter:', typeof attachDeployRouter)
