import { getGlobalDispatcher } from 'undici'

const reach = getGlobalDispatcher()
console.error('[t]')
console.error('global dispatcher type:', reach?.constructor?.name)
console.error('keys:', Object.keys(reach || {}))

// Now make a request
await fetch('http://127.0.0.1:0').catch(() => {})

console.error('handles after fetch attempt:', process._getActiveHandles().length)
console.error('reqs after fetch attempt:', process._getActiveRequests().length)

// Close dispatcher
await reach.close().catch(() => {})

console.error('after close')
console.error('handles after close:', process._getActiveHandles().length)
console.error('reqs after close:', process._getActiveRequests().length)
