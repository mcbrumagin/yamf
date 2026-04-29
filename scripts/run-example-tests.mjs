#!/usr/bin/env node
/**
 * Run `yamf test --as-test '*.example.js' -d <dir>` for each workspace package
 * that contains at least one `*.example.js` file.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'packages/cli/src/cli.js')

const dirs = [
  path.join(root, 'packages/core'),
  path.join(root, 'packages/client'),
  path.join(root, 'packages/shared')
]
const svcRoot = path.join(root, 'packages/services')
for (const name of fs.readdirSync(svcRoot)) {
  const p = path.join(svcRoot, name)
  if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'package.json'))) {
    dirs.push(p)
  }
}

function hasExample (dir) {
  let found = false
  function walk (d) {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (['node_modules', '.git', 'coverage', 'dist', 'build'].includes(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.example.js')) found = true
    }
  }
  walk(dir)
  return found
}

let exitCode = 0
for (const dir of dirs) {
  if (!hasExample(dir)) continue
  console.error(`\n>>> run-example-tests: ${path.relative(root, dir)}`)
  const r = spawnSync(process.execPath, [cli, 'test', '--as-test', '*.example.js', '-d', dir], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env }
  })
  if (r.status !== 0) exitCode = r.status || 1
}

process.exit(exitCode)
