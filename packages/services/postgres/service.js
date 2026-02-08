import {
  createService,
  Logger,
  HttpError,
  next,
  envConfig
} from '@yamf/core'

import postgres from 'postgres'
import { toCamelCase } from '@yamf/shared'


// TODO
const defaultPsqlConfig = {
  PGDATABASE: 'yamf',
  PGUSER: 'yamf',
  PGPASSWORD: 'changeme'
}

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

export default async function createPostgreSqlService({
  serviceName = 'postgres-service',
  psqlConfig = defaultPsqlConfig,
  schema = null,
  seed = null
}) {

  console.warn({psqlConfig})
  const sql = postgres(psqlConfig) // psql environment variables

  /**
   * Processes a template query string with provided data using safe parameterized queries.
   * 
   * SECURITY: This implementation avoids the dangerous `new Function()` pattern.
   * Instead, it extracts placeholders, validates them strictly, and uses postgres.js's
   * built-in parameterized query support which safely escapes all values.
   * 
   * Template placeholders use camelCase (e.g., :userId, :isActive) to match JS data keys.
   * SQL column names in the template are written as snake_case by the developer.
   * Output is automatically converted from snake_case to camelCase.
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
    
    // Replace :name placeholders with $1, $2, etc. for parameterized query
    let paramIndex = 0
    const parameterizedQuery = template.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, () => {
      return `$${++paramIndex}`
    })
    
    console.warn({ parameterizedQuery, values })
    
    try {
      // Use sql.unsafe for the parameterized query - this is safe because:
      // 1. The query structure is from our template (not user input in production)
      // 2. All values are passed as parameters, never interpolated into the query string
      // 3. postgres.js handles proper escaping of parameter values
      const result = await sql.unsafe(parameterizedQuery, values)
      
      // Convert result keys from snake_case to camelCase for JS consumption
      console.warn('RESULT', result)
      return mapCase ? toCamelCase(result) : result
    } catch (err) {
      const httpError = new HttpError(500, `Query error: ${err.message}`)
      httpError.stack = err.stack
      httpError.parameterizedQuery = parameterizedQuery
      console.warn(parameterizedQuery)
      throw httpError
    }
  }


  let service = await createService(serviceName, async ({ template, data, options }) => {
    if (!template) throw new HttpError(400, 'Expected "template" query string in payload')
    if (!data) throw new HttpError(400, 'Expected "data" map in payload')
    return await processQueryTemplate(template, data, options)
  })

  return service
}
