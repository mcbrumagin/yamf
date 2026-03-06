/**
 * Load-balanced service example.
 *
 * Registers "simple-service" using whichever YAMF_SERVICE_URL is set.
 * Run two instances with different YAMF_SERVICE_URL values to simulate
 * load-balanced locations on the same registry:
 *
 *   YAMF_SERVICE_URL=http://localhost    node load-balanced.js
 *   YAMF_SERVICE_URL=http://127.0.0.1   node load-balanced.js
 *
 * Or use the CLI:
 *   yamf start example/load-balanced.js
 *   yamf start example/load-balanced.js --env YAMF_SERVICE_URL=http://127.0.0.1
 */

import { createService } from '@yamf/core'

const host = process.env.YAMF_SERVICE_URL || 'http://localhost'

await createService('simple-service', async (payload) => {
  return { message: `Hello from ${host}!`, host }
})

