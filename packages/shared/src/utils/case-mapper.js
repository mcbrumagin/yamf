/**
 * Case Mapping Utilities
 * 
 * Convert object keys between camelCase and snake_case.
 * Used to bridge JavaScript conventions with PostgreSQL column naming.
 */

/**
 * Convert a single string from camelCase to snake_case
 * @param {string} str - camelCase string
 * @returns {string} snake_case string
 * 
 * @example
 * camelToSnake('userId') // 'user_id'
 * camelToSnake('isActive') // 'is_active'
 * camelToSnake('createdAt') // 'created_at'
 */
export function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

/**
 * Convert a single string from snake_case to camelCase
 * @param {string} str - snake_case string
 * @returns {string} camelCase string
 * 
 * @example
 * snakeToCamel('user_id') // 'userId'
 * snakeToCamel('is_active') // 'isActive'
 * snakeToCamel('created_at') // 'createdAt'
 */
export function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Recursively convert all object keys from camelCase to snake_case
 * @param {*} obj - Object, array, or primitive value
 * @returns {*} Deep copy with snake_case keys
 * 
 * @example
 * toSnakeCase({ userId: 1, isActive: true })
 * // { user_id: 1, is_active: true }
 * 
 * toSnakeCase([{ createdAt: '2024-01-01' }])
 * // [{ created_at: '2024-01-01' }]
 */
export function toSnakeCase(obj) {
  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase)
  }
  
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  
  // Handle Date objects - return as-is
  if (obj instanceof Date) {
    return obj
  }
  
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      camelToSnake(key),
      toSnakeCase(value)
    ])
  )
}

/**
 * Recursively convert all object keys from snake_case to camelCase
 * @param {*} obj - Object, array, or primitive value
 * @returns {*} Deep copy with camelCase keys
 * 
 * @example
 * toCamelCase({ user_id: 1, is_active: true })
 * // { userId: 1, isActive: true }
 * 
 * toCamelCase([{ created_at: '2024-01-01' }])
 * // [{ createdAt: '2024-01-01' }]
 */
export function toCamelCase(obj) {
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase)
  }
  
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  
  // Handle Date objects - return as-is
  if (obj instanceof Date) {
    return obj
  }
  
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      snakeToCamel(key),
      toCamelCase(value)
    ])
  )
}

/**
 * Create a mapping object from a schema
 * Maps camelCase field names to snake_case column names
 * @param {Object} schema - Schema object with field definitions
 * @returns {Object} Mapping of camelCase -> snake_case
 * 
 * @example
 * const schema = { userId: is.int, isActive: is.boolean }
 * createColumnMapping(schema)
 * // { userId: 'user_id', isActive: 'is_active' }
 */
export function createColumnMapping(schema) {
  const mapping = {}
  for (const key of Object.keys(schema)) {
    mapping[key] = camelToSnake(key)
  }
  return mapping
}

/**
 * Create a reverse mapping object from a schema
 * Maps snake_case column names to camelCase field names
 * @param {Object} schema - Schema object with field definitions
 * @returns {Object} Mapping of snake_case -> camelCase
 * 
 * @example
 * const schema = { userId: is.int, isActive: is.boolean }
 * createFieldMapping(schema)
 * // { user_id: 'userId', is_active: 'isActive' }
 */
export function createFieldMapping(schema) {
  const mapping = {}
  for (const key of Object.keys(schema)) {
    mapping[camelToSnake(key)] = key
  }
  return mapping
}
