import { createService } from '@yamf/core'

createService('service2', async function (payload = {}) {
  payload.service2 = true
  return this.call('service3', payload)
})
.catch(err => console.error(err))
