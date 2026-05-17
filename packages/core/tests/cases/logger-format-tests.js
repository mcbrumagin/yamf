/**
 * Logger plain-line timestamps and LOG_JSON single-line output (subprocess smoke).
 */
import { assert } from '@yamf/test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(__dirname, '..', '..')

function runFixture (name) {
  const script = join(pkgRoot, 'tests', 'fixtures', name)
  const r = spawnSync(process.execPath, [script], {
    cwd: pkgRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' }
  })
  if (r.status !== 0) {
    throw new Error((r.stderr || '') + (r.stdout || '') || `fixture ${name} exit ${r.status}`)
  }
  return (r.stdout || '').trim()
}

export async function testJsonLogLineIncludesIsoTimestampAndMessage () {
  const out = runFixture('logger-json-smoke.mjs')
  const line = out.split(/\r?\n/).filter(Boolean).pop()
  const rec = JSON.parse(line)
  await assert(rec.ts, t => /^\d{4}-\d{2}-\d{2}T/.test(String(t)))
  await assert(rec.msg, m => m === 'ping-json')
}

export async function testPlainLogOmitsBracketTimestampWhenDisabled () {
  const out = runFixture('logger-plain-no-ts-smoke.mjs')
  const line = out.split(/\r?\n/).filter(Boolean).pop()
  await assert(line, l => l.includes('plain-no-ts'))
  await assert(line, l => !/\[\d{4}-\d{2}-\d{2}T/.test(l))
}
