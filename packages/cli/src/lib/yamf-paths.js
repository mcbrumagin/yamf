import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/**
 * @param {string} [cwd]
 * @returns {string}
 */
export function getYamfHome (cwd = process.cwd()) {
  const h = process.env.YAMF_HOME || join(cwd, '.yamf')
  mkdirSync(h, { recursive: true })
  return h
}

/**
 * @param {string} serviceName
 * @param {string} [cwd]
 */
export function getServiceBuildDir (serviceName, cwd = process.cwd()) {
  return join(getYamfHome(cwd), 'build', serviceName)
}

/**
 * @param {string} [cwd]
 */
export function getBuildIndexPath (cwd = process.cwd()) {
  return join(getYamfHome(cwd), 'build', 'index.json')
}
