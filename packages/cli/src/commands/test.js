/**
 * yamf test - Discover and run @yamf/test suites
 *
 * Discovers test files by:
 * - Containing import from '@yamf/test'
 * - NOT importing TestRunner or runTests (those are runners)
 * - Exporting plain functions (export function / export async function)
 *
 * Loads .env.test from the working directory before running.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

// TODO: Add --env KEY=val support for inline env overrides (e.g. yamf test --env YAMF_REGISTRY_URL=http://localhost:20000)

const EXCLUDED_DIRS = ['node_modules', '.git', 'coverage', 'dist', 'build']

function parseArgs(args) {
  const options = {
    dir: process.cwd(),
    file: null,
    name: null,
    list: false,
    help: false,
    verbose: false
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-d' || arg === '--dir') {
      options.dir = args[++i] ?? process.cwd()
    } else if (arg === '-f' || arg === '--file') {
      options.file = args[++i] ?? null
    } else if (arg === '-n' || arg === '--name') {
      options.name = args[++i] ?? null
    } else if (arg === '--list') {
      options.list = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true
    }
  }

  options.dir = path.resolve(process.cwd(), options.dir)
  return options
}

function getTestHelp() {
  return `
yamf test - Discover and run @yamf/test suites

Discovers test files that import @yamf/test and export plain functions.
Loads .env.test from the working directory.

Usage:
  yamf test [options]

Options:
  -d, --dir <path>    Working directory for discovery (default: cwd)
  -f, --file <glob>  Filter files by name (substring or * wildcard)
  -n, --name <regex> Filter tests by name (regex or * wildcard)
  --list              List discovered suites/files without running
  -v, --verbose       Verbose output
  -h, --help          Show this help
`
}

function loadEnvTest(dir) {
  let envPath = null
  const candidates = [
    path.join(dir, '.env.test'),
    path.join(process.cwd(), '.env.test')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      envPath = p
      break
    }
  }
  if (!envPath) {
    let current = path.resolve(dir)
    const root = path.parse(current).root
    while (current !== root) {
      const p = path.join(current, '.env.test')
      if (fs.existsSync(p)) {
        envPath = p
        break
      }
      current = path.dirname(current)
    }
  }
  if (!envPath) return
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        let value = trimmed.slice(eqIdx + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        process.env[key] = value
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Warning: Could not load .env.test: ${err.message}`)
    }
  }
}

function isTestFile(filePath, content) {
  if (!content.includes("'@yamf/test'") && !content.includes('"@yamf/test"')) {
    return false
  }

  const importMatch = content.match(/import\s*\{[\s\S]*?\}\s*from\s*['"]@yamf\/test['"]/)
  if (!importMatch) return false

  if (/\b(TestRunner|runTests)\b/.test(importMatch[0])) {
    return false
  }

  if (!content.match(/export\s+(async\s+)?function\s+\w+/)) {
    return false
  }

  return true
}

function matchesFileFilter(filePath, pattern) {
  if (!pattern) return true
  const baseName = path.basename(filePath)
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return regex.test(baseName)
  }
  return baseName.includes(pattern)
}

function getTestNameRegex(pattern) {
  if (!pattern) return null
  if (pattern.includes('*')) {
    return new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
  }
  return new RegExp(pattern)
}

function findTestFiles(rootDir, options) {
  const results = []
  const dir = path.resolve(rootDir)

  function walk(currentDir) {
    let entries
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch (err) {
      if (options.verbose) console.warn(`Warning: Cannot read ${currentDir}: ${err.message}`)
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.includes(entry.name)) {
          walk(fullPath)
        }
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        if (!matchesFileFilter(fullPath, options.file)) continue

        let content
        try {
          content = fs.readFileSync(fullPath, 'utf8')
        } catch (err) {
          if (options.verbose) console.warn(`Warning: Cannot read ${fullPath}: ${err.message}`)
          continue
        }

        if (isTestFile(fullPath, content)) {
          results.push(fullPath)
        }
      }
    }
  }

  walk(dir)
  return results
}

function extractTestFns(module, suiteName, nameRegex) {
  const fns = {}
  for (const key of Object.keys(module)) {
    if (key === 'default') continue
    const fn = module[key]
    if (typeof fn === 'function') {
      if (nameRegex && !nameRegex.test(key)) continue
      fns[key] = fn
    }
  }
  return fns
}

export async function runTestCommand(args) {
  const options = parseArgs(args)

  if (options.help) {
    console.log(getTestHelp())
    return
  }

  loadEnvTest(options.dir)

  let TestRunner
  try {
    const testModule = await import('@yamf/test')
    TestRunner = testModule.TestRunner
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message?.includes('Cannot find package')) {
      console.error(`The 'test' subcommand requires @yamf/test. Install it with:`)
      console.error('')
      console.error('  pnpm add -D @yamf/test')
      console.error('')
      process.exit(1)
    }
    throw err
  }

  const testFiles = findTestFiles(options.dir, options)

  if (options.list) {
    if (testFiles.length === 0) {
      console.log('No test files found.')
      return
    }
    console.log(`Found ${testFiles.length} test file(s):`)
    for (const f of testFiles) {
      const rel = path.relative(options.dir, f)
      console.log(`  ${rel}`)
    }
    return
  }

  if (testFiles.length === 0) {
    console.error('No test files found.')
    console.error('Test files must import @yamf/test and export plain functions.')
    process.exit(1)
  }

  const nameRegex = getTestNameRegex(options.name)
  const runner = new TestRunner()

  for (const filePath of testFiles) {
    const mod = await import(pathToFileURL(path.resolve(filePath)).href)
    const suiteName = path.basename(filePath, path.extname(filePath))
    const testFns = extractTestFns(mod, suiteName, nameRegex)

    if (Object.keys(testFns).length > 0) {
      runner.addSuite(suiteName, testFns)
    }
  }

  try {
    await runner.run()
    process.exit(0)
  } catch (err) {
    console.error(err.stack)
    process.exit(err.code || 1)
  }
}
