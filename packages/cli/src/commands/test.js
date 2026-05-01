/**
 * yamf test - Discover and run @yamf/test suites
 *
 * Normal discovery: imports @yamf/test, exports plain functions (not TestRunner/runTests).
 * -f filters by basename; when set, *.e2e-tests.js are included (narrowing intent).
 * --as-test: runs matching *.js files as child processes (script orchestrator).
 *
 * Loads .env.test from the working directory before running.
 */

import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import parseArgs from '../lib/parse-args.js'
import {
  discoverAsTestFiles,
  findYamfRepoRoot,
  runScriptAsTest,
  buildGeneratePayload,
  writeGenerateFile
} from '../lib/as-test-runner.js'

const EXCLUDED_DIRS = ['node_modules', '.git', 'coverage', 'dist', 'build', '.yamf', 'tmp']

const ARGS = {
  help: { flags: ['-h', '--help'] },
  verbose: { flags: ['-v', '--verbose'] },
  list: { flags: ['--list'] },
  timings: { flags: ['--timings'] },
  dir: { flags: ['-d', '--dir'], type: 'string', default: process.cwd() },
  file: { flags: ['-f', '--file'], type: 'string' },
  name: { flags: ['-n', '--name'], type: 'string' },
  asTest: { flags: ['--as-test'] },
  generate: { flags: ['--generate'] },
  generateOut: { flags: ['--generate-out'], type: 'string' },
  timeout: { flags: ['--timeout'], type: 'number', default: 30000 },
  settle: { flags: ['--settle'], type: 'number', default: 250 },
  includeE2e: { flags: ['--include-e2e'] }
}

function getTestHelp () {
  return `
yamf test - Discover and run @yamf/test suites

Normal mode discovers files that import @yamf/test and export plain functions.
Use -f to filter by basename (substring or *); e2e suites are included when -f is set.
Use --as-test with -f to run matching scripts as child-process integration checks.

Loads .env.test from the working directory.

Usage:
  yamf test [options]

Options:
  -d, --dir <path>      Working directory for discovery (default: cwd)
  -f, --file <glob>     Filter files by basename (substring or * wildcard)
  -n, --name <regex>    Filter tests by name (regex or * wildcard)
  --as-test             Run basename glob matches as scripts (requires -f).
                        Assigns YAMF_REGISTRY_URL per case; SIGTERM shutdown.
  --generate            With --as-test: write generated suite file and exit 0
  --generate-out <path> Output path for --generate (implies --generate)
  --timeout <ms>        Per-test timeout (normal and --as-test). Default 30000.
  --settle <ms>         --as-test only: wait after port open before SIGTERM. Default 250.
  --include-e2e         Include *.e2e-tests.js when scanning without -f (default: excluded)
  --list                List discovered suites/files without running
  --timings             After the run, print a slowest-first per-test table (or set YAMF_TEST_TIMINGS=true)
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
        // Full-tree runs exclude e2e unless --include-e2e. With -f, include e2e so
        // basename filters (e.g. *.e2e-tests.js) can match.
        if (!options.includeE2e && !options.file && entry.name.endsWith('.e2e-tests.js')) {
          continue
        }

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

export async function runTestCommand (args) {
  let options
  try {
    options = parseArgs(args, ARGS)
  } catch (e) {
    console.error(String(e.message || e))
    process.exit(2)
  }

  options.dir = path.resolve(process.cwd(), options.dir)

  if (options.help) {
    console.log(getTestHelp())
    return
  }

  const wantsGenerate = options.generate || (options.generateOut != null && options.generateOut !== '')
  if (wantsGenerate && !options.asTest) {
    console.error('Error: --generate requires --as-test.')
    process.exit(2)
  }

  if (options.asTest && !options.file) {
    console.error('Error: --as-test requires -f/--file (basename glob).')
    process.exit(2)
  }

  if (options.timeout === 0 || (typeof options.timeout === 'number' && options.timeout < 0)) {
    console.error('Error: --timeout must be a positive number (ms).')
    process.exit(2)
  }

  loadEnvTest(options.dir)
  const { default: envConfig } = await import('@yamf/core/env-config')
  envConfig.reloadFromProcessEnv()

  if (options.list && options.asTest) {
    const matched = discoverAsTestFiles(options.dir, options.file)
    if (matched.length === 0) {
      console.log('No files matched.')
      return
    }
    console.log(`Found ${matched.length} file(s):`)
    for (const f of matched) {
      console.log(`  ${path.relative(options.dir, f)}`)
    }
    return
  }

  if (options.asTest) {
    const matched = discoverAsTestFiles(options.dir, options.file)
    if (matched.length === 0) {
      console.error(`No files matched ${options.file} under ${options.dir}`)
      process.exit(1)
    }

    if (wantsGenerate) {
      const repoRoot = findYamfRepoRoot(options.dir)
      const dirArg = path.relative(repoRoot, options.dir).replace(/\\/g, '/') || '.'
      const { path: outPath, content } = buildGeneratePayload(
        repoRoot,
        dirArg,
        options.file,
        matched,
        options.generateOut || null
      )
      writeGenerateFile(outPath, content)
      console.log(`wrote ${outPath} (${matched.length} case(s))`)
      process.exit(0)
    }
  }

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

  process.env.YAMF_TEST_CASE_TIMEOUT_MS = String(options.timeout)
  if (options.asTest) {
    delete process.env.YAMF_TEST_CASE_TIMEOUT_MS
  }

  const nameRegex = getTestNameRegex(options.name)
  const runner = new TestRunner()

  if (options.asTest) {
    const matched = discoverAsTestFiles(options.dir, options.file)
    const suiteFns = {}
    for (const filePath of matched) {
      const relKey = path.relative(options.dir, filePath).replace(/\\/g, '/') || path.basename(filePath)
      if (nameRegex && !nameRegex.test(relKey)) continue
      const fn = async function () {
        await runScriptAsTest(filePath, {
          timeoutMs: options.timeout,
          settleMs: options.settle,
          onLine: options.verbose
            ? (line) => {
                process.stderr.write(line + '\n')
              }
            : undefined
        })
      }
      Object.defineProperty(fn, 'name', { value: relKey })
      suiteFns[relKey] = fn
    }
    if (Object.keys(suiteFns).length > 0) {
      runner.addSuite('as-test', suiteFns)
    }
  } else {
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

    for (const filePath of testFiles) {
      const mod = await import(pathToFileURL(path.resolve(filePath)).href)
      const suiteName = path.basename(filePath, path.extname(filePath))
      let testFns = extractTestFns(mod, suiteName, nameRegex)
      testFns = filterFns(testFns, nameRegex)

      if (Object.keys(testFns).length > 0) {
        runner.addSuite(suiteName, testFns)
      }
    }
  }

  if (options.timings) {
    process.env.YAMF_TEST_TIMINGS = 'true'
    const { default: envConfigReload } = await import('@yamf/core/env-config')
    envConfigReload.reloadFromProcessEnv()
  }

  try {
    await runner.run()
    process.exit(0)
  } catch (err) {
    console.error(err.stack)
    process.exit(err.code || 1)
  }
}
