import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registryServer } from '@yamf/core'
import createFileUploadService from '@yamf/services-file-upload'

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

const uploadDir = mkdtempSync(join(tmpdir(), 'yamf-ul-ex-'))

await registryServer()
const srv = await createFileUploadService({ uploadDir })
console.log('file-upload service:', srv.name, 'dir:', uploadDir)
