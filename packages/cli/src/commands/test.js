/**
 * yamf test - Discover and run @yamf/test suites
 *
 * Normal discovery: imports @yamf/test, exports plain functions (not TestRunner/runTests).
 * --as-test: runs *.example.js or other JS matched by glob without requiring @yamf/test import.
 *
 * Loads .env.test from the working directory before running.
 */

import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import parseArgs from '../lib/parse-args.js'

const EXCLUDED_DIRS = ['node_modules', '.git', 'coverage', 'dist', 'build']

const ARGS = {
  help: { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  list: { flags: ['--list'] },
  timings: { flags: ['--timings'] },
  dir: { flags: ['-d', '--dir'], type: 'string', default: process.cwd() },
  file: { flags: ['-f', '--file'], type: 'string' },
  name: { flags: ['-n', '--name'], type: 'string' },
  asTest: { flags: ['--as-test'], type: 'string' },
  includeE2e: { flags: ['--include-e2e'] }
}

function getTestHelp () {
  return `
yamf test - Discover and run @yamf/test suites

Normal mode discovers files that import @yamf/test and export plain functions.
Use --as-test <glob> to run example scripts (*.example.js) without that import.

Loads .env.test from the working directory.

Usage:
  yamf test [options]

Options:
  -d, --dir <path>      Working directory for discovery (default: cwd)
  -f, --file <glob>     Filter files by basename (substring or * wildcard)
  -n, --name <regex>    Filter tests by name (regex or * wildcard)
  --as-test <glob>      Run matching .js files as tests (basename glob; required value).
                        Uses default export as the test body; optional setup/teardown exports.
  --include-e2e         Include *.e2e-tests.js files (default: excluded from normal runs)
  --list                List discovered suites/files without running
  --timings             After the run, print a slowest-first per-test table (or set YAMF_TEST_TIMINGS=1)
  -v, --verbose         Verbose output
  -h, --help            Show this help
`
}

function loadEnvTest (dir) {
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

function isTestFile (filePath, content) {
  if (!content.includes("'@yamf/test'") && !content.includes('"@yamf/test"')) {
    return false
  }

  const importMatch = content.match(/import\s*\{[\s\S]*?\}\s*from\s*['"]@yamf\/test['"]/)
  if (!importMatch) return false

  if (/\b(TestRunner|runTests)\b/.test(importMatch[0])) {
    console.warn(`Test file "${filePath}" not auto-imported because it runs its own tests.`)
    return false
  }

  if (!content.match(/export\s+(async\s+)?function\s+\w+/)) {
    return false
  }

  return true
}

/**
 * Turn a basename glob (only `*` is special) into a safe RegExp.
 * Dots and other regex metacharacters are escaped so `*.example.js` matches
 * `foo.example.js` but not `media-streaming-example.js`.
 */
function globBasenameToRegex (pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      out += '.*'
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  return new RegExp('^' + out + '$')
}

function matchesFileFilter (filePath, pattern) {
  if (!pattern) return true
  const baseName = path.basename(filePath)
  if (pattern.includes('*')) {
    return globBasenameToRegex(pattern).test(baseName)
  }
  return baseName.includes(pattern)
}

function getTestNameRegex (pattern) {
  if (!pattern) return null
  if (pattern.includes('*')) {
    return new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
  }
  return new RegExp(pattern)
}

function findTestFiles (rootDir, options) {
  const results = []
  const dir = path.resolve(rootDir)

  function walk (currentDir) {
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
        if (options.asTest) {
          if (!matchesFileFilter(fullPath, options.asTest)) continue
          if (options.file && !matchesFileFilter(fullPath, options.file)) continue
          results.push(fullPath)
          continue
        }

        if (!options.includeE2e && entry.name.endsWith('.e2e-tests.js')) continue

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

function extractTestFns (module, suiteName, nameRegex) {
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

function filterFns (fns, nameRegex) {
  if (!nameRegex) return fns
  const out = {}
  for (const key of Object.keys(fns)) {
    if (nameRegex.test(key)) out[key] = fns[key]
  }
  return out
}

/**
 * Wrap a module with default export into named test fns for TestRunner.addSuite.
 */
export function wrapExampleModule (filePath, mod) {
  const baseName = path.basename(filePath, path.extname(filePath))
  const label = (typeof mod.name === 'string' && mod.name) || baseName
  const setup = typeof mod.setup === 'function' ? mod.setup : null
  const teardown = typeof mod.teardown === 'function' ? mod.teardown : null
  const body = typeof mod.default === 'function' ? mod.default : null

  if (body) {
    const fn = async function () {
      if (setup) await setup()
      try {
        await body()
      } finally {
        if (teardown) await teardown()
      }
    }
    Object.defineProperty(fn, 'name', { value: label })
    if (mod.mute) fn.mute = true
    if (mod.solo) fn.solo = true
    return { [label]: fn }
  }

  const named = {}
  for (const key of Object.keys(mod)) {
    if (key === 'default' || key === 'name' || key === 'setup' || key === 'teardown') continue
    if (typeof mod[key] === 'function' && /^test/.test(key)) named[key] = mod[key]
  }
  return named
}

export async function runTestCommand (args) {
  const options = parseArgs(args, ARGS)
  options.dir = path.resolve(process.cwd(), options.dir)

  if (options.help) {
    console.log(getTestHelp())
    return
  }

  if (options.asTest !== null && options.asTest !== undefined && String(options.asTest).trim() === '') {
    console.error('Error: --as-test requires a non-empty pattern.')
    process.exit(1)
  }

  loadEnvTest(options.dir)

  let TestRunner
  try {
    const testModule = await import('@yamf/test')
    TestRunner = testModule.TestRunner
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && err.message.includes('@yamf/test') || err.message?.includes('Cannot find package')) {
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
    if (options.asTest) {
      console.error('No files matched --as-test pattern and filters.')
    } else {
      console.error('Test files must import @yamf/test and export plain functions (or use --as-test).')
    }
    process.exit(1)
  }

  if (options.timings) {
    process.env.YAMF_TEST_TIMINGS = '1'
  }

  const nameRegex = getTestNameRegex(options.name)
  const runner = new TestRunner()

  for (const filePath of testFiles) {
    const mod = await import(pathToFileURL(path.resolve(filePath)).href)
    const suiteName = path.basename(filePath, path.extname(filePath))
    let testFns
    if (options.asTest) {
      testFns = wrapExampleModule(filePath, mod)
      testFns = filterFns(testFns, nameRegex)
    } else {
      testFns = extractTestFns(mod, suiteName, nameRegex)
    }

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
