import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registryServer } from '@yamf/core'
import { assert, terminateAfter } from '@yamf/test'
import createStaticFileService from './service.js'

export const name = 'file-server: static root'

export default async function run () {
  const dir = mkdtempSync(join(tmpdir(), 'yamf-fs-ex-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>ok</body></html>')
  await terminateAfter(
    () => registryServer(),
    async () => {
      const srv = await createStaticFileService({
        rootDir: dir,
        externalRootDir: true,
        urlRoot: '/',
        fileMap: { '/': 'index.html' }
      })
      await assert(srv.name === 'static-file-service', x => x === true)
    }
  )
}
