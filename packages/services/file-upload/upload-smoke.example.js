import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registryServer } from '@yamf/core'
import { assert, terminateAfter } from '@yamf/test'
import createFileUploadService from '@yamf/services-file-upload'

export const name = 'file-upload: service boots'

export default async function run () {
  const uploadDir = mkdtempSync(join(tmpdir(), 'yamf-ul-ex-'))
  await terminateAfter(
    () => registryServer(),
    () => createFileUploadService({ uploadDir }),
    async (_, srv) => {
      await assert(srv.name === 'file-upload-service', x => x === true)
    }
  )
}
