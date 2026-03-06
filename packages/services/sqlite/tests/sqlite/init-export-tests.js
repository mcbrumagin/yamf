/**
 * SQLite Init/Export Integration Tests
 *
 * Tests ensureDbPath, schema, seed, and backup helpers.
 * Uses temp directories - no external setup required.
 *
 * Run: yamf test -d packages/services/sqlite
 */

import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  assert,
  terminateAfter
} from '@yamf/test'

import {
  registryServer,
  callService
} from '@yamf/core'

import createSqliteService, { ensureDbPath } from '../../service.js'

export async function testEnsureDbPath_CreatesNestedDir() {
  const baseDir = mkdtempSync(join(tmpdir(), 'yamf-sqlite-'))
  const dbPath = join(baseDir, 'nested', 'dir', 'db.sqlite')

  await ensureDbPath(dbPath)

  await assert(existsSync(join(baseDir, 'nested', 'dir')), x => x === true)
}

export async function testEnsureDbPath_SkipsMemory() {
  const result = await ensureDbPath(':memory:')
  await assert(result, r => r === ':memory:')
}

export async function testSchema_RunsOnInit() {
  await terminateAfter(
    await registryServer(),
    await createSqliteService({
      sqliteConfig: ':memory:',
      schema: `
        CREATE TABLE _schema_test (
          id INTEGER PRIMARY KEY,
          name TEXT
        )
      `
    }),
    async (registry, service) => {
      const result = await callService('sqlite-service', {
        template: 'SELECT name FROM sqlite_master WHERE type = :type AND name = :name',
        data: { type: 'table', name: '_schema_test' }
      })
      await assert(result,
        r => r.length === 1,
        r => r[0].name === '_schema_test'
      )
    }
  )
}

export async function testSeed_RunsAfterSchema() {
  await terminateAfter(
    await registryServer(),
    await createSqliteService({
      sqliteConfig: ':memory:',
      schema: `
        CREATE TABLE _seed_test (
          id INTEGER PRIMARY KEY,
          val TEXT
        )
      `,
      seed: `INSERT INTO _seed_test (id, val) VALUES (1, 'seeded')`
    }),
    async (registry, service) => {
      const result = await callService('sqlite-service', {
        template: 'SELECT val FROM _seed_test WHERE id = :id',
        data: { id: 1 }
      })
      await assert(result,
        r => r.length === 1,
        r => r[0].val === 'seeded'
      )
    }
  )
}

export async function testBackup_ExportsToFile() {
  const baseDir = mkdtempSync(join(tmpdir(), 'yamf-sqlite-'))
  const backupPath = join(baseDir, 'backup.sqlite')

  await terminateAfter(
    await registryServer(),
    await createSqliteService({
      sqliteConfig: ':memory:',
      schema: `
        CREATE TABLE _backup_test (id INTEGER PRIMARY KEY, data TEXT);
        INSERT INTO _backup_test VALUES (1, 'exported');
      `
    }),
    async (registry, service) => {
      const pages = await service.backup(backupPath)
      await assert(pages, p => typeof p === 'number' && p > 0)
      await assert(existsSync(backupPath), x => x === true)
      await assert(readFileSync(backupPath).length > 0, x => x > 0)
    }
  )
}

export async function testFileDb_InitAndBackup() {
  const baseDir = mkdtempSync(join(tmpdir(), 'yamf-sqlite-'))
  const dbPath = join(baseDir, 'persistent.sqlite')
  const backupPath = join(baseDir, 'export.sqlite')

  await ensureDbPath(dbPath)

  await terminateAfter(
    await registryServer(),
    await createSqliteService({
      sqliteConfig: dbPath,
      schema: `
        CREATE TABLE _persist_test (id INTEGER PRIMARY KEY, label TEXT);
        INSERT INTO _persist_test VALUES (1, 'from_file');
      `
    }),
    async (registry, service) => {
      const result = await callService('sqlite-service', {
        template: 'SELECT label FROM _persist_test WHERE id = :id',
        data: { id: 1 }
      })
      await assert(result, r => r[0].label === 'from_file')

      await service.backup(backupPath)
      await assert(existsSync(backupPath), x => x === true)
    }
  )
}
