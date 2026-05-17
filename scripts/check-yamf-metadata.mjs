#!/usr/bin/env node
/**
 * Validates first-party @yamf/* package.json files for consistent engines and license.
 * Run from repo root: node scripts/check-yamf-metadata.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_NODE = '>=22.0.0'
const REQUIRED_LICENSE = 'MIT'

/** @returns {string[]} */
function firstPartyPackageDirs() {
  const out = []
  const packagesRoot = join(root, 'packages')
  for (const name of readdirSync(packagesRoot)) {
    const dir = join(packagesRoot, name)
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg.name === 'string' && pkg.name.startsWith('@yamf/')) {
      out.push(dir)
    }
  }
  const servicesRoot = join(packagesRoot, 'services')
  if (existsSync(servicesRoot)) {
    for (const name of readdirSync(servicesRoot)) {
      const dir = join(servicesRoot, name)
      const pkgPath = join(dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (typeof pkg.name === 'string' && pkg.name.startsWith('@yamf/')) {
        out.push(dir)
      }
    }
  }
  return out
}

function main() {
  const errors = []
  for (const dir of firstPartyPackageDirs()) {
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const label = pkg.name || pkgPath
    if (pkg.engines?.node !== REQUIRED_NODE) {
      errors.push(
        `${label}: engines.node must be "${REQUIRED_NODE}" (got ${JSON.stringify(pkg.engines?.node)})`
      )
    }
    if (pkg.license !== REQUIRED_LICENSE) {
      errors.push(`${label}: license must be "${REQUIRED_LICENSE}" (got ${JSON.stringify(pkg.license)})`)
    }
  }
  if (errors.length) {
    console.error('check-yamf-metadata failed:\n' + errors.join('\n'))
    process.exit(1)
  }
  console.log('check-yamf-metadata: OK (@yamf/* engines + license)')
}

main()
