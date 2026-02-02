/**
 * Validation Errors
 * 
 * Error classes for schema validation and data validation failures.
 * Designed to be compatible with @yamf/test assertion patterns.
 */

/**
 * Represents a single validation failure
 */
export class ValidationFailure {
  constructor(path, value, constraint, message) {
    this.path = path           // e.g., 'user.address.zip'
    this.value = value         // The actual value that failed
    this.constraint = constraint // e.g., 'minLength', 'pattern', 'type'
    this.message = message     // Human-readable message
  }

  toString(depth = 1) {
    const pad = '  '.repeat(depth)
    const pathStr = this.path || '(root)'
    const valueStr = this.formatValue(this.value)
    return `${pad}at "${pathStr}": ${this.message}\n${pad}  received: ${valueStr}`
  }

  formatValue(val) {
    if (val === undefined) return 'undefined'
    if (val === null) return 'null'
    if (typeof val === 'string') return `"${val.length > 50 ? val.slice(0, 50) + '...' : val}"`
    if (typeof val === 'object') {
      try {
        const str = JSON.stringify(val)
        return str.length > 100 ? str.slice(0, 100) + '...' : str
      } catch {
        return '[object]'
      }
    }
    return String(val)
  }

  get assertMessage() {
    return this.toString(0)
  }
}

/**
 * Error thrown when data fails validation
 * Contains all validation failures (not just the first one)
 */
export class ValidationError extends Error {
  constructor(failures, schemaName = null) {
    const failureCount = failures.length
    const noun = failureCount === 1 ? 'failure' : 'failures'
    const nameStr = schemaName ? ` for "${schemaName}"` : ''
    super(`Validation failed${nameStr}: ${failureCount} ${noun}`)
    
    this.name = 'ValidationError'
    this.failures = failures
    this.schemaName = schemaName
  }

  toString() {
    return `${this.message}\n${this.failures.map(f => f.toString(1)).join('\n')}`
  }

  get assertMessage() {
    return this.toString()
  }
}

/**
 * Error thrown when a schema itself is invalid
 * (e.g., min > max, empty oneOf, etc.)
 */
export class SchemaError extends Error {
  constructor(message, path = null) {
    const pathStr = path ? ` at "${path}"` : ''
    super(`Invalid schema${pathStr}: ${message}`)
    
    this.name = 'SchemaError'
    this.schemaPath = path
  }
}
