/**
 * Bundle entry for build+deploy tests. Change BUNDLE_MARK to force a new content hash.
 */
import { createService } from '@yamf/core'

export const BUNDLE_MARK = 'v1'

await createService('deploy-int-svc', async () => ({
  service: 'deploy-int-svc',
  mark: BUNDLE_MARK
}))
