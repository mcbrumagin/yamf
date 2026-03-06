import {
  createService,
  HttpError
} from '@yamf/core'

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'
import { toCamelCase } from '@yamf/shared'

const defaultSqliteConfig = ':memory:'

// Strict pattern for placeholder names - only valid identifiers allowed
const VALID_PLACEHOLDER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Validates that a placeholder name is safe (alphanumeric + underscore, starts with letter/underscore)
 * This prevents code injection through malicious placeholder names.
 */
function validatePlaceholderName(name) {
  if (!VALID_PLACEHOLDER_PATTERN.test(name)) {
    throw new HttpError(400, `Invalid placeholder name: "${name}". Must be a valid identifier.`)
  }
  return true
}

/**
 * Ensures the parent directory exists for a file-backed database path.
 * No-op for :memory: or file: URLs.
 *
 * @param {string} path - Database path (e.g. './data/app.sqlite')
 * @returns {Promise<string>} The path, for chaining
 */
export async function ensureDbPath(path) {
  if (path === ':memory:' || path.startsWith('file:')) {
    return path
  }
  const dir = dirname(path)
  if (dir && dir !== '.') {
    await mkdir(dir, { recursive: true })
  }
  return path
}

function runSchema(db, schema) {
  if (!schema) return
  const statements = Array.isArray(schema) ? schema : [schema]
  for (const sql of statements) {
    if (typeof sql === 'string' && sql.trim()) {
      db.exec(sql)
    }
  }
}

function runSeed(db, seed) {
  if (!seed) return
  if (typeof seed === 'function') {
    seed(db)
  } else {
    const statements = Array.isArray(seed) ? seed : [seed]
    for (const sql of statements) {
      if (typeof sql === 'string' && sql.trim()) {
        db.exec(sql)
      }
    }
  }
}

export default async function createSqliteService({
  serviceName = 'sqlite-service',
  sqliteConfig = defaultSqliteConfig,
  schema = null,
  seed = null
}) {
  const db = new DatabaseSync(sqliteConfig)
  runSchema(db, schema)
  runSeed(db, seed)

  /**
   * Processes a template query string with provided data using safe parameterized queries.
   *
   * Uses the same :placeholder syntax and snake_case→camelCase mapping as the postgres service.
   * Converts :param to SQLite's ? positional placeholders and uses prepared statements.
   *
   * @param {string} template The string containing `:<name>` placeholders (camelCase).
   * @param {object} data An object with camelCase keys corresponding to the placeholders.
   * @param {object} options Query options.
   * @param {boolean} options.mapCase Whether to convert output from snake_case to camelCase (default: true)
   * @returns {Promise<Array>} The query result with camelCase keys.
   */
  async function processQueryTemplate(template, data, options = {}) {
    const { mapCase = true } = options

    // Extract all placeholder names from template (placeholders are camelCase)
    const placeholderMatches = [...template.matchAll(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g)]
    const placeholders = placeholderMatches.map(m => m[1])

    // Validate all placeholder names are safe identifiers
    for (const name of placeholders) {
      validatePlaceholderName(name)
    }

    // Check all placeholders have corresponding data
    for (const name of placeholders) {
      if (!(name in data)) {
        throw new HttpError(400, `Missing data for placeholder: "${name}"`)
      }
    }

    // Build the values array in placeholder order
    const values = placeholders.map(name => data[name])

    // Replace :name placeholders with ? (SQLite uses positional ? not $1, $2)
    let parameterizedQuery = template.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, () => '?')
    // Convert Postgres-style ::type casts to SQLite CAST(? AS type) for template portability
    parameterizedQuery = parameterizedQuery.replace(/\?\s*::\s*([a-zA-Z]\w*)/g, (_, type) => `CAST(? AS ${type})`)

    try {
      const stmt = db.prepare(parameterizedQuery)
      const isSelect = /^\s*(SELECT|WITH)\s/i.test(template.trim()) || /RETURNING\s/i.test(template)
      const result = isSelect ? stmt.all(...values) : stmt.run(...values)

      // For SELECT/WITH/RETURNING: result is array of row objects
      // For INSERT/UPDATE/DELETE: result is { changes, lastInsertRowid }; return [] for consistency with postgres
      const rows = Array.isArray(result) ? result : []
      return mapCase ? toCamelCase(rows) : rows
    } catch (err) {
      const httpError = new HttpError(500, `Query error: ${err.message}`)
      httpError.stack = err.stack
      httpError.parameterizedQuery = parameterizedQuery
      throw httpError
    }
  }

  const service = await createService(serviceName, async ({ template, data, options }) => {
    if (!template) throw new HttpError(400, 'Expected "template" query string in payload')
    if (!data) throw new HttpError(400, 'Expected "data" map in payload')
    return await processQueryTemplate(template, data, options)
  })

  /**
   * Export/backup the database to a file.
   *
   * @param {string} targetPath - Path for the backup file
   * @param {object} options - Optional { rate, progress } for sqlite backup API
   * @returns {Promise<number>} Total pages transferred
   */
  async function backup(targetPath, options = {}) {
    return sqliteBackup(db, targetPath, options)
  }

  service.database = db
  service.backup = backup

  return service
}
