// Modern environment configuration utility for Node.js 22+
import { readFile } from 'node:fs/promises'
// NOTE no custom logger here, this config is required for Logger initialization

// TODO implement secret management

class EnvConfig {
  constructor() {
    this.config = new Map()
    this.loadEnvironmentVariables()
  }

  // Load environment variables with validation and type conversion
  loadEnvironmentVariables() {
    for (const [key, value] of Object.entries(process.env)) {
      let parsed = this.parseValue(value)
      if (key === 'LOG_LEVEL' && typeof parsed === 'string') {
        parsed = parsed.toLowerCase()
      }
      this.config.set(key, parsed)
    }
  }

  /** Resync from process.env after callers mutate env (e.g. yamf test loading .env.test). */
  reloadFromProcessEnv () {
    this.config.clear()
    this.loadEnvironmentVariables()
  }

  // Parse values to appropriate types
  parseValue(value) {
    if (!value) return value

    const lower = value.toLowerCase()

    // Boolean values (canonical + common legacy encodings)
    if (lower === 'true') return true
    if (lower === 'false') return false
    if (lower === 'on' || lower === 'yes') return true
    if (lower === 'off' || lower === 'no') return false

    // Numeric values
    if (/^\d+$/.test(value)) return parseInt(value, 10)
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value)
    
    // JSON values (arrays, objects)
    if ((value.startsWith('[') && value.endsWith(']')) || 
        (value.startsWith('{') && value.endsWith('}'))) {
      try {
        return JSON.parse(value)
      } catch {
        console.warn(`Failed to parse JSON environment variable: ${value}`)
      }
    }
    
    return value
  }

  // Get configuration value with optional default
  get(key, defaultValue = undefined) {
    return this.config.get(key) ?? defaultValue
  }

  // Get required configuration value (throws if missing)
  getRequired(key) {
    const value = this.config.get(key)
    if (value === undefined) {
      throw new Error(`Required environment variable "${key}" is not set`)
    }
    return value
  }

  set(key, value) {
    this.config.set(key, value)
  }

  has(key) {
    return this.config.has(key)
  }

  // Load additional configuration from .env file (Node.js --env-file style alternative)
  async loadEnvFile(filePath = '.env') {
    try {
      const envContent = await readFile(filePath, 'utf8')
      const lines = envContent.split('\n')
      
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine || trimmedLine.startsWith('#')) continue
        
        const [key, ...valueParts] = trimmedLine.split('=')
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '') // Remove quotes
          this.config.set(key, this.parseValue(value))
        }
      }
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Failed to load environment file ${filePath}:`, error.message)
      }
    }
  }

  toObject() {
    return Object.fromEntries(this.config)
  }

  validateRequired(requiredKeys) {
    const missing = requiredKeys.filter(key => !this.has(key))
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
    }
  }
}

// Export singleton instance
const envConfig = new EnvConfig()
export default envConfig
export { EnvConfig }

/**
 * Coerce an env-config value (or raw process.env string) to boolean.
 * Accepts `true` / `false`, `1` / `0`, `on` / `off`, `yes` / `no` (case-insensitive).
 * @param {unknown} value
 * @returns {boolean}
 */
export function envTruthy (value) {
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  if (value == null || value === '') return false
  if (typeof value === 'string') {
    const s = value.toLowerCase()
    if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true
    if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false
  }
  return false
}
