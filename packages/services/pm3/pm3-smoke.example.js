/**
 * PM3-managed process service factory — no real child processes in this smoke script.
 */
const mod = await import('./service.js')
console.log('createPm3Service:', typeof mod.default)
