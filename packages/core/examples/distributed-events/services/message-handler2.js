import { createService } from '@yamf/core'

console.log({env: process.env})

createSubscription('global-event', async function messageHandler2 (message) {
  console.log('messageHandler2 - message:', message)
})
.catch(err => console.error(err))
