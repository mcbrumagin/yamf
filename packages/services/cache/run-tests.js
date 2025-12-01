import { runTests, withEnv } from '@yamf/test'

withEnv({
  YAMF_REGISTRY_URL: 'http://localhost:20000'
}, async () => {
  const cacheTests = await import('./cache-tests.js')
  await runTests(cacheTests)
  .then(() => {
    process.exit(0)
  }).catch(err => {
    process.exit(err.code || 1)
  })
})
