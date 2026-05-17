import { createService } from '@yamf/core'

console.log({env: process.env})

createService('service2', async function (payload = {}) {
  payload.service2 = true
  return this.call('service3', payload)
})
.catch(err => console.error(err))
