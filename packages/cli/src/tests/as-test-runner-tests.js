/**
 * Pure / fast paths in `lib/as-test-runner.js` (discovery, generate payload, timeout branch).
 */
import { assert, assertErr } from '@yamf/test'
import { mkdtempSync, writeFileSync, unlinkSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  discoverAsTestFiles,
  globBasenameToRegex,
  buildGeneratePayload,
  defaultGenerateOutPath,
  runScriptAsTest
} from '../lib/as-test-runner.js'

export function testGlobBasenameToRegexStar () {
  const rx = globBasenameToRegex('*.example.js')
  assert(rx.test('foo.example.js'), (x) => x === true)
  assert(rx.test('foo.js'), (x) => x === false)
}

export function testDiscoverAsTestFilesRespectsGlob () {
  const dir = mkdtempSync(join(tmpdir(), 'yamf-asdisc-'))
  try {
    writeFileSync(join(dir, 'a.example.js'), '// a', 'utf8')
    writeFileSync(join(dir, 'b.js'), '// b', 'utf8')
    const found = discoverAsTestFiles(dir, '*.example.js')
    assert(found.length, (n) => n === 1)
    assert(found[0], (p) => p.endsWith('a.example.js'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function testBuildGeneratePayloadContainsHarnessImport () {
  const repo = mkdtempSync(join(tmpdir(), 'yamf-genrepo-'))
  const dir = join(repo, 'pkg')
  try {
    mkdirSync(dir, { recursive: true })
    const script = join(dir, 'one.example.js')
    writeFileSync(script, 'console.log(1)\n', 'utf8')
    const { path: outPath, content } = buildGeneratePayload(repo, 'pkg', '*.example.js', [script], null)
    assert(outPath, (p) => p.includes('.yamf') && p.includes('generated'))
    assert(content, (c) => c.includes('runScriptAsTest') && c.includes('AUTO-GENERATED'))
    assert(defaultGenerateOutPath(repo, 'pkg', '*.example.js'), (p) => p.endsWith('.test.js'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

export async function testRunScriptAsTestTimesOutWhenPortNeverOpens () {
  const scriptPath = join(tmpdir(), `yamf-hang-${Date.now()}.js`)
  writeFileSync(
    scriptPath,
    `// Keep process alive without binding YAMF_REGISTRY_URL port.\nsetInterval(() => {}, 1000)\n`,
    'utf8'
  )
  try {
    await assertErr(
      async () => runScriptAsTest(scriptPath, { timeoutMs: 450, settleMs: 5 }),
      (e) =>
        /timed out waiting for port or exit/i.test(e.message) ||
        /exited before registry port opened/i.test(e.message)
    )
  } finally {
    try {
      unlinkSync(scriptPath)
    } catch { /* */ }
  }
}
