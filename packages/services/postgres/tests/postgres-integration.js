/**
 * PostgreSQL Service Integration Tests
 *
 * These tests require a running PostgreSQL database.
 * Configure via PGDATABASE, PGUSER, PGPASSWORD or TEST_PSQL_URL.
 *
 * Run: yamf test -d packages/services/postgres
 * Or:  cd packages/services/postgres && pnpm test
 */

import {
  assert,
  assertErr,
  terminateAfter
} from '@yamf/test'

import {
  registryServer,
  callService
} from '@yamf/core'

import createPostgreSqlService from '../service.js'

const TEST_PSQL_CONFIG = process.env.TEST_PSQL_URL ||
  `postgres://${process.env.PGUSER || 'yamf'}:${process.env.PGPASSWORD || 'changeme'}@localhost/${process.env.PGDATABASE || 'yamf'}`

export async function testPostgres_BasicQuery() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: 'SELECT 1 + 1 AS sum',
        data: {}
      })
      await assert(result,
        r => Array.isArray(r),
        r => r.length === 1,
        r => r[0].sum === 2
      )
    }
  )
}

export async function testPostgres_ParameterizedQuery() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: 'SELECT :a::integer + :b::integer AS sum',
        data: { a: 5, b: 3 }
      })
      await assert(result, r => r[0].sum === 8)
    }
  )
}

export async function testPostgres_CaseMapping() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: `SELECT 'test' AS my_column_name, 123 AS another_value`,
        data: {}
      })
      await assert(result,
        r => r[0].myColumnName === 'test',
        r => r[0].anotherValue === 123
      )
    }
  )
}

export async function testPostgres_MapCaseFalse() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: `SELECT 'raw' AS snake_case_key`,
        data: {},
        options: { mapCase: false }
      })
      await assert(result,
        r => r[0].snake_case_key === 'raw'
      )
    }
  )
}

export async function testPostgres_EmptyResult() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: 'SELECT 1 AS id WHERE false',
        data: {}
      })
      await assert(result,
        r => Array.isArray(r),
        r => r.length === 0
      )
    }
  )
}

export async function testPostgres_MultipleRows() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: 'SELECT generate_series(1, 5) AS num',
        data: {}
      })
      await assert(result,
        r => Array.isArray(r),
        r => r.length === 5,
        r => r[0].num === 1,
        r => r[4].num === 5
      )
    }
  )
}

export async function testPostgres_NullParameter() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: 'SELECT :val::text IS NULL AS is_null',
        data: { val: null }
      })
      await assert(result, r => r[0].isNull === true)
    }
  )
}

export async function testPostgres_MissingPlaceholder() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('postgres-service', {
          template: 'SELECT :missingParam AS value',
          data: { otherParam: 1 }
        }),
        err => err.status === 400,
        err => err.message.includes('Missing data for placeholder')
      )
    }
  )
}

export async function testPostgres_ReusedPlaceholder() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      const result = await callService('postgres-service', {
        template: 'SELECT :x::integer AS a, :x::integer + 1 AS b',
        data: { x: 10 }
      })
      await assert(result,
        r => r[0].a === 10,
        r => r[0].b === 11
      )
    }
  )
}

export async function testPostgres_MissingTemplate() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('postgres-service', {
          data: {}
        }),
        err => err.status === 400,
        err => err.message.includes('Expected "template"')
      )
    }
  )
}

export async function testPostgres_MissingData() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('postgres-service', {
          template: 'SELECT 1',
          data: null
        }),
        err => err.status === 400,
        err => err.message.includes('Expected "data"')
      )
    }
  )
}

export async function testPostgres_SqlError() {
  await terminateAfter(
    await registryServer(),
    await createPostgreSqlService({ psqlConfig: TEST_PSQL_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('postgres-service', {
          template: 'SELECT * FROM nonexistent_table_xyz',
          data: {}
        }),
        err => err.status === 500,
        err => err.message.includes('nonexistent_table_xyz') || err.message.includes('Query error')
      )
    }
  )
}
