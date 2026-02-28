import {
  registryServer,
  createService,
  callService
} from '@yamf/core'

async function main() {
  await registryServer()
  await createService('simple-service', async (payload) => {
    return { message: 'Hello, world!' }
  })

  const result = await callService('simple-service')
  console.log(result)
}

main()
