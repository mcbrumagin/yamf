import { createSubscription } from '@yamf/core'

console.log({env: process.env})

createSubscription('global-event', async function messageHandler (message) {
  console.log('messageHandler - message:', message)
})
.catch(err => console.error(err))
