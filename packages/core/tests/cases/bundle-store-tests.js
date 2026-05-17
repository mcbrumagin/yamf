/**
 * `bundle-store.js` — path validation, tmp+rename happy path, hash mismatch cleanup.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'

import { assert, assertErr } from '@yamf/test'
import { createBundleStore, streamBundleToFileWithHashCheck } from '../../src/registry/bundle-store.js'

export function testPathForRejectsInvalidHash () {
  const dir = mkdtempSync(join(tmpdir(), 'yamf-bundle-'))
  const store = createBundleStore(dir)
  assertErr(
    () => store.pathFor('not-a-sha256'),
    (e) => e instanceof Error && /invalid bundle hash/i.test(e.message)
  )
}

export async function testStreamBundleRenamesTmpOnMatch () {
  const dir = mkdtempSync(join(tmpdir(), 'yamf-bundle-'))
  const body = Buffer.from('hello-bundle')
  const digest = `sha256-${createHash('sha256').update(body).digest('hex')}`
  const out = join(dir, 'out.mjs')
  await streamBundleToFileWithHashCheck(Readable.from([body]), digest, out)
  assert(readFileSync(out), (b) => Buffer.compare(b, body) === 0)
  assert(existsSync(`${out}.part`), (x) => x === false)
}

export async function testStreamBundleMismatchRemovesPartFile () {
  const dir = mkdtempSync(join(tmpdir(), 'yamf-bundle-'))
  const body = Buffer.from('a')
  const wrongDigest = `sha256-${createHash('sha256').update(Buffer.from('b')).digest('hex')}`
  const out = join(dir, 'bad.mjs')
  await assertErr(
    async () =>
      streamBundleToFileWithHashCheck(Readable.from([body]), wrongDigest, out),
    (e) => e.code === 'BUNDLE_HASH_MISMATCH'
  )
  assert(existsSync(out), (x) => x === false)
  assert(existsSync(`${out}.part`), (x) => x === false)
}
