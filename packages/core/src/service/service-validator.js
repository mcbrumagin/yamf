/**
 * Service Validator
 * Validates and normalizes service URLs, locations, and configuration
 */

import os from 'node:os'
import envConfig from '../shared/env-config.js'
import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-service-core' })

/**
 * Validate and extract registry host from environment
 * @throws {Error} if YAMF_REGISTRY_URL is not defined
 */
export function getRegistryHost() {
  const registryHost = envConfig.get('YAMF_REGISTRY_URL')
  if (!registryHost) {
    throw new Error('Please define "YAMF_REGISTRY_URL" env variable')
  }
  return registryHost
}

/**
 * Parse URL into components
 * Returns { protocol, hostname, port }
 */
export function parseUrl(url) {
  const urlObject = new URL(url)
  
  let {
    protocol,
    hostname,
    port,
    pathname,
    search
  } = urlObject

  // edgecase: no proto results in weird parse, so just error [eg. localhost:8000]
  if (protocol && !hostname && pathname) throw new Error('Invalid URL')

  return {
    protocol,
    hostname,
    port,
    pathname,
    search,
    full: url
  }
}

/**
 * Determine service home (domain/hostname) for registration
 * Priority:
 * 1. YAMF_SERVICE_URL if defined
 * 2. Registry host without port
 * 3. System hostname as fallback
 */
export function determineServiceHome(registryHost) {
  const serviceUrl = envConfig.get('YAMF_SERVICE_URL')
  
  if (serviceUrl) {
    // Use explicitly set service URL
    const parsed = parseUrl(serviceUrl)
    if (parsed.port) {
      // TODO TEST
      // Allow user to set the port in-case it is needed by external services (without lookup/callService)
      logger.warn(logger.removeWhitespace(`Registering configured port ${parsed.port} for service ${parsed.hostname};
        if errors occur, try creating the service earlier or removing the port from YAMF_SERVICE_URL`
      ))
      return `${parsed.protocol}//${parsed.hostname}:${parsed.port}`
    } else return `${parsed.protocol}//${parsed.hostname}` 
  }
  
  // Default mode: assume we are on the registryHost, let the registry assign the port
  const parsed = parseUrl(registryHost)
  return `${parsed.protocol}//${parsed.hostname}`
}

/**
 * Extract port from location string
 * Location format: "protocol://hostname:port"
 */
export function extractPort(location) {
  if (!location) return null
  const parts = location.split(':')
  return parts[2] || null
}

/**
 * Validate port number
 */
export function validatePort(port) {
  const portNum = Number(port)
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error(`Invalid port number: ${port}`)
  }
  return portNum
}

/**
 * Check if YAMF_SERVICE_URL has a hardcoded port
 * Returns { hasPort: boolean, port: number|null, url: string }
 */
export function checkServiceUrlPort() {
  const serviceUrl = envConfig.get('YAMF_SERVICE_URL')
  if (!serviceUrl) {
    return { hasPort: false, port: null, url: null }
  }
  
  const parsed = parseUrl(serviceUrl)
  return {
    hasPort: parsed.port !== null,
    port: parsed.port ? Number(parsed.port) : null,
    url: serviceUrl
  }
}

/**
 * Validate service location against expected configuration
 * Throws helpful errors if there's a conflict
 */
export function validateServiceLocation(location, expectedPort = null) {
  if (!location) {
    throw new Error('Service location cannot be empty')
  }
  
  const port = extractPort(location)
  if (!port) {
    throw new Error(`Service location missing port: ${location}`)
  }
  
  validatePort(port)
  
  // Check for port conflicts if user specified YAMF_SERVICE_URL with port
  const serviceUrlCheck = checkServiceUrlPort()
  if (serviceUrlCheck.hasPort && expectedPort && serviceUrlCheck.port !== Number(expectedPort)) {
    throw new Error(
      `Port conflict detected!\n` +
      `YAMF_SERVICE_URL specifies port ${serviceUrlCheck.port}, ` +
      `but registry assigned port ${expectedPort}.\n\n` +
      `To fix this, either:\n` +
      `  1. Remove the port from YAMF_SERVICE_URL and let the registry assign one\n` +
      `  2. Ensure this service is registered before others to claim the desired port\n` +
      `  3. Choose a different port that is not in use`
    )
  }
  
  return { location, port: Number(port) }
}

/**
 * Validate service name
 */
export function validateServiceName(name) {
  if (typeof name !== 'string' || !name) {
    throw new Error('Service name must be a non-empty string')
  }
  
  // Check for valid characters (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_$-]+$/.test(name)) {
    throw new Error(
      `Service name "${name}" contains invalid characters. ` +
      `Use only alphanumeric characters, hyphens, underscores, and dollars.`
    )
  }
  
  return name
}

