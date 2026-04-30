import { createService } from '@yamf/core'

console.log({env: process.env})

createService('service3', async function (payload = {}) {
  payload.service3 = true
  return payload
})
.catch(err => console.error(err))
