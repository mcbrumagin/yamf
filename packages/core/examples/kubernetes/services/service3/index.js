const { createService } = require('@yamf/core')

createService(async function service3(payload = {}) {
  payload.service3 = true
  return payload
})
.catch(err => console.error(err))
