#!/usr/bin/env node
/**
 * Run `*.e2e-tests.js` under selected test directories (postgres-backed / integration).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'packages/cli/src/cli.js')

const dirs = [
  'packages/core/tests/cases',
  'packages/services/postgres/tests',
  'packages/services/sqlite/tests',
  'packages/services/user/tests',
  'packages/services/auth/tests',
  'packages/shared/tests'
]

function hasE2e (dir) {
  let found = false
  function walk (d) {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.e2e-tests.js')) found = true
    }
  }
  walk(dir)
  return found
}

let exitCode = 0
for (const rel of dirs) {
  const dir = path.join(root, rel)
  if (!fs.existsSync(dir) || !hasE2e(dir)) continue
  console.error(`\n>>> run-e2e-tests: ${rel}`)
  const r = spawnSync(process.execPath, [cli, 'test', '-d', dir, '--include-e2e', '-f', 'e2e-tests'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env }
  })
  if (r.status !== 0) exitCode = r.status || 1
}

process.exit(exitCode)
