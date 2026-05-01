import { assert, pickListenPort, terminateAfter, withEnv } from '@yamf/test'
import { registryServer, gatewayServer, createService, callService, envConfig } from '../../src/index.js'

function startRegistry () {
  return registryServer()
}

function startGateway () {
  return gatewayServer()
}

function startPrivateEcho () {
  return createService('private-echo', function (p) {
    return { echo: p }
  }, { accessControl: 'private' })
}

async function assertPrivateEchoCall () {
  const r = await callService('private-echo', { x: 1 })
  await assert(r, (x) => x?.echo?.x === 1)
}

export async function testCallPrivateServiceWithRegistryDefaults () {
  const regPort = await pickListenPort()
  const gwPort = await pickListenPort()
  const regUrl = `http://127.0.0.1:${regPort}`
  const gwUrl = `http://127.0.0.1:${gwPort}`
  await withEnv(
    { YAMF_REGISTRY_URL: regUrl, YAMF_GATEWAY_URL: gwUrl },
    async function isolatedAccessControlE2E () {
      envConfig.reloadFromProcessEnv()
      await terminateAfter(startRegistry, startGateway, startPrivateEcho, assertPrivateEchoCall)
    }
  )
}
