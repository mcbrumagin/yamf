/**
 * terminateAfter single-fn overload (in-process registry tracking from @yamf/core).
 */
import { assert, terminateAfter, withEnv, pickListenPort } from '@yamf/test'
import { registryServer, createService } from '@yamf/core'

export async function testTerminateAfterSingleFnStopsRegistryCascade () {
  const port = await pickListenPort()
  await withEnv({ YAMF_REGISTRY_URL: `http://127.0.0.1:${port}` }, async () => {
    let ran = false
    await terminateAfter(async () => {
      await registryServer()
      await createService('noop', function noop () {
        return {}
      })
      ran = true
    })
    await assert(ran, r => r === true)
  })
}

export async function testTerminateAfterSingleFnNoRegistryNoOp () {
  await terminateAfter(async () => {
    await assert(1 + 1, x => x === 2)
  })
}

export async function testTerminateAfterSingleFnPropagatesBodyError () {
  let saw = false
  try {
    await terminateAfter(async () => {
      throw new Error('body-fail')
    })
  } catch (e) {
    saw = e instanceof Error && e.message === 'body-fail'
  }
  await assert(saw, s => s === true)
}

export async function testTerminateAfterVerboseTeardownEnvSafe () {
  const prev = process.env.YAMF_TEST_VERBOSE_TEARDOWN
  process.env.YAMF_TEST_VERBOSE_TEARDOWN = 'true'
  try {
    await terminateAfter(async () => {})
  } finally {
    if (prev === undefined) delete process.env.YAMF_TEST_VERBOSE_TEARDOWN
    else process.env.YAMF_TEST_VERBOSE_TEARDOWN = prev
  }
}

export async function testTerminateAfterMultiArgUnchanged () {
  const port = await pickListenPort()
  await withEnv({ YAMF_REGISTRY_URL: `http://127.0.0.1:${port}` }, async () => {
    await terminateAfter(
      () => registryServer(),
      () => createService('ex', function ex () {
        return { ok: true }
      }),
      async () => {
        await assert(1, n => n === 1)
      }
    )
  })
}
