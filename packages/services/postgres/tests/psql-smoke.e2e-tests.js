import { assert, terminateAfter } from '@yamf/test'
import { registryServer, callService } from '@yamf/core'
import createPostgresService from '../service.js'

export async function testPostgresSelectOneE2E () {
  const url =
    process.env.YAMF_TEST_POSTGRES_URL ||
    process.env.YAMF_TEST_PSQL_URL ||
    process.env.TEST_PSQL_URL
  if (!url) {
    console.warn('skip testPostgresSelectOneE2E: YAMF_TEST_POSTGRES_URL not set')
    return
  }
  await terminateAfter(async function psqlSmokeBody () {
    await registryServer()
    await createPostgresService({ psqlConfig: url })
    const rows = await callService('postgres', {
      template: 'SELECT 1 as one',
      data: {}
    })
    await assert(rows, (r) => Array.isArray(r) && (r[0]?.one === 1 || r[0]?.one === '1'))

    const mapped = await callService('postgres', {
      template: 'SELECT :answer::int as raw_snake_value',
      data: { answer: 7 }
    })
    await assert(
      mapped,
      (r) => Array.isArray(r),
      (r) => r[0]?.rawSnakeValue === 7 || r[0]?.rawSnakeValue === '7'
    )
  })
}
