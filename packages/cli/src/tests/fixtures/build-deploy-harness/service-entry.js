/**
 * Bundle entry for build+deploy tests. Change BUNDLE_MARK to force a new content hash.
 *
 * - Default export: used by yamf contract extract (`YAMF_EXTRACT_SERVICE_CONTRACT`) and must call createService.
 * - Main guard: when the registry/pm3 runs `node <this-bundle.mjs>`, start the service. When the CLI
 *   dynamic-imports the bundle for contract diff, process.argv[1] is not this file, so the guard is skipped.
 */
import { createService } from "file:///home/mcbrumagin/Development/gitea/yamf/packages/core/src/index.js"
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const BUNDLE_MARK = 'v1'

export default async function deployIntSvcMain () {
  return createService('deploy-int-svc', async () => ({
    service: 'deploy-int-svc',
    mark: BUNDLE_MARK
  }))
}

const isDirectNodeEntry = () =>
  !!process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isDirectNodeEntry()) {
  await deployIntSvcMain()
}
