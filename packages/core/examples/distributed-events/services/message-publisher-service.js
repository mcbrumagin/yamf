import { createService } from '@yamf/core'

console.log({env: process.env})

createService('messagePublisherService', async function (payload = {}) {
  payload.messagePublisherService = true
  this.publish('global-event', payload)
})
.catch(err => console.error(err))
