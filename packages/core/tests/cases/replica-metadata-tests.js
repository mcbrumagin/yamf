import { assert, terminateAfter } from '@yamf/test'
import { registryServer, httpRequest, HEADERS, COMMANDS, buildRegisterHeaders } from '../../src/index.js'

const registryOpts = { broadcastShutdownOnTerminate: false }

export async function testRegistryPullIncludesReplicasWithSourceHash () {
  await terminateAfter(
    () => registryServer(registryOpts),
    async () => {
      const url = process.env.YAMF_REGISTRY_URL
      const token = process.env.YAMF_REGISTRY_TOKEN
      const loc = 'http://127.0.0.1:45001'
      await httpRequest(url, {
        headers: buildRegisterHeaders('replica-test-svc', loc, {
          accessControl: 'private',
          registryToken: token,
          metadata: { sourceHash: 'sha256-deadbeef', cacheBulk: true }
        })
      })
      const pull = await httpRequest(url, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
          ...(token && { [HEADERS.REGISTRY_TOKEN]: token })
        }
      })
      const rep = pull.replicas?.['replica-test-svc']
      await assert(Array.isArray(rep), (x) => x === true)
      await assert(rep.length, (n) => n >= 1)
      const row = rep.find((r) => r.location === loc)
      await assert(row?.sourceHash, (h) => h === 'sha256-deadbeef')
    }
  )
}

export async function testReplicaMetadataClearsOnUnregister () {
  await terminateAfter(
    () => registryServer(registryOpts),
    async () => {
      const url = process.env.YAMF_REGISTRY_URL
      const token = process.env.YAMF_REGISTRY_TOKEN
      const loc = 'http://127.0.0.1:45002'
      await httpRequest(url, {
        headers: buildRegisterHeaders('replica-unreg-svc', loc, {
          accessControl: 'private',
          registryToken: token,
          metadata: { sourceHash: 'sha256-aaa' }
        })
      })
      await httpRequest(url, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.SERVICE_UNREGISTER,
          [HEADERS.SERVICE_NAME]: 'replica-unreg-svc',
          [HEADERS.SERVICE_LOCATION]: loc,
          ...(token && { [HEADERS.REGISTRY_TOKEN]: token })
        }
      })
      const pull = await httpRequest(url, {
        headers: {
          [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL,
          ...(token && { [HEADERS.REGISTRY_TOKEN]: token })
        }
      })
      const rep = pull.replicas?.['replica-unreg-svc']
      await assert(rep == null || rep.length === 0, (x) => x === true)
    }
  )
}
