/**
 * SQLite Service Integration Tests
 *
 * Uses in-memory database (:memory:) - no external setup required.
 *
 * Run: yamf test -d packages/services/sqlite
 * Or:  cd packages/services/sqlite && pnpm test
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

import createSqliteService from '../service.js'

const SQLITE_CONFIG = ':memory:'

export async function testSqlite_BasicQuery() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
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

export async function testSqlite_ParameterizedQuery() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
        template: 'SELECT CAST(:a AS INTEGER) + CAST(:b AS INTEGER) AS sum',
        data: { a: 5, b: 3 }
      })
      await assert(result, r => r[0].sum === 8)
    }
  )
}

export async function testSqlite_PostgresStyleCast() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
        template: 'SELECT :a::integer + :b::integer AS sum',
        data: { a: 5, b: 3 }
      })
      await assert(result, r => r[0].sum === 8)
    }
  )
}

export async function testSqlite_CaseMapping() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
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

export async function testSqlite_MapCaseFalse() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
        template: `SELECT 'raw' AS snake_case_key`,
        data: {},
        options: { mapCase: false }
      })
      await assert(result, r => r[0].snake_case_key === 'raw')
    }
  )
}

export async function testSqlite_EmptyResult() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
        template: 'SELECT 1 AS id WHERE 0',
        data: {}
      })
      await assert(result,
        r => Array.isArray(r),
        r => r.length === 0
      )
    }
  )
}

export async function testSqlite_MultipleRows() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
        template: `WITH RECURSIVE nums(n) AS (
          SELECT 1
          UNION ALL
          SELECT n + 1 FROM nums WHERE n < 5
        )
        SELECT n AS num FROM nums`,
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

export async function testSqlite_NullParameter() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
        template: 'SELECT CAST(:val AS TEXT) IS NULL AS is_null',
        data: { val: null }
      })
      await assert(result, r => r[0].isNull === 1)
    }
  )
}

export async function testSqlite_MissingPlaceholder() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('sqlite-service', {
          template: 'SELECT :missingParam AS value',
          data: { otherParam: 1 }
        }),
        err => err.status === 400,
        err => err.message.includes('Missing data for placeholder')
      )
    }
  )
}

export async function testSqlite_ReusedPlaceholder() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      const result = await callService('sqlite-service', {
        template: 'SELECT CAST(:x AS INTEGER) AS a, CAST(:x AS INTEGER) + 1 AS b',
        data: { x: 10 }
      })
      await assert(result,
        r => r[0].a === 10,
        r => r[0].b === 11
      )
    }
  )
}

export async function testSqlite_MissingTemplate() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('sqlite-service', {
          data: {}
        }),
        err => err.status === 400,
        err => err.message.includes('Expected "template"')
      )
    }
  )
}

export async function testSqlite_MissingData() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('sqlite-service', {
          template: 'SELECT 1',
          data: null
        }),
        err => err.status === 400,
        err => err.message.includes('Expected "data"')
      )
    }
  )
}

export async function testSqlite_SqlError() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      await assertErr(
        async () => callService('sqlite-service', {
          template: 'SELECT * FROM nonexistent_table_xyz',
          data: {}
        }),
        err => err.status === 500,
        err => err.message.includes('nonexistent_table_xyz') || err.message.includes('Query error')
      )
    }
  )
}

export async function testSqlite_InsertReturning() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      await callService('sqlite-service', {
        template: `CREATE TABLE _test_insert (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT
        )`,
        data: {}
      })
      const result = await callService('sqlite-service', {
        template: 'INSERT INTO _test_insert (label) VALUES (:label) RETURNING id, label',
        data: { label: 'hello' }
      })
      await assert(result,
        r => r.length === 1,
        r => r[0].label === 'hello',
        r => typeof r[0].id === 'number'
      )
      await callService('sqlite-service', {
        template: 'DROP TABLE _test_insert',
        data: {}
      })
    }
  )
}

export async function testSqlite_InsertReturnsEmpty() {
  await terminateAfter(
    () => registryServer(),
    () => createSqliteService({ sqliteConfig: SQLITE_CONFIG }),
    async () => {
      await callService('sqlite-service', {
        template: `CREATE TABLE _test_write (
          id INTEGER PRIMARY KEY,
          val TEXT
        )`,
        data: {}
      })
      const result = await callService('sqlite-service', {
        template: 'INSERT INTO _test_write (id, val) VALUES (:id, :val)',
        data: { id: 1, val: 'test' }
      })
      await assert(result,
        r => Array.isArray(r),
        r => r.length === 0
      )
      await callService('sqlite-service', {
        template: 'DROP TABLE _test_write',
        data: {}
      })
    }
  )
}
