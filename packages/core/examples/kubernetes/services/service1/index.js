import { createService } from '@yamf/core'

createService('service1', async function (payload = {}) {
  payload.service1 = true
  return this.call('service2', payload)
})
.catch(err => console.error(err))
