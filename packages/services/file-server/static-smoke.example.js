import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registryServer } from '@yamf/core'
import createStaticFileService from './service.js'

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

const dir = mkdtempSync(join(tmpdir(), 'yamf-fs-ex-'))
writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>ok</body></html>')

await registryServer()
const srv = await createStaticFileService({
  rootDir: dir,
  externalRootDir: true,
  urlRoot: '/',
  fileMap: { '/': 'index.html' }
})
console.log('static file service:', srv.name, 'root:', dir)
