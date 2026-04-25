import { assert } from '@yamf/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeBundleHash, hashLockfilesAtProjectRoot } from '../lib/bundle-hash.js'

export async function testBundleHashIsDeterministic () {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const a = computeBundleHash(bytes, {
    entry: 'src/svc.js',
    env: ['A', 'B'],
    deps: { 'a.js': 'sha256-aa' },
    nodeTarget: 'node20',
    builderVersion: '0.0.0'
  })
  const b = computeBundleHash(Buffer.from([1, 2, 3, 4]), {
    entry: 'src/svc.js',
    env: ['B', 'A'],
    deps: { 'a.js': 'sha256-aa' },
    nodeTarget: 'node20',
    builderVersion: '0.0.0'
  })
  await assert(a, (h) => h === b && h.startsWith('sha256-'))
}

export async function testHashLockfilesFallsBackToPackageJsonWhenNoLockfile () {
  const dir = mkdtempSync(join(tmpdir(), 'yamf-bundle-hash-'))
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'hash-fixture', version: '1.0.0', dependencies: { a: '1.2.3' } }, null, 2),
      'utf8'
    )
    const deps = hashLockfilesAtProjectRoot(dir)
    await assert(Object.keys(deps), (keys) => keys.length === 1 && keys[0] === 'package.json')
    await assert(deps['package.json'], (v) => typeof v === 'string' && v.startsWith('sha256-'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function testHashLockfilesPrefersLockfileSetWhenPresent () {
  const dir = mkdtempSync(join(tmpdir(), 'yamf-bundle-hash-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'hash-fixture' }, null, 2), 'utf8')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n', 'utf8')
    const deps = hashLockfilesAtProjectRoot(dir)
    await assert('pnpm-lock.yaml' in deps, (x) => x === true)
    await assert('package.json' in deps, (x) => x === false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
