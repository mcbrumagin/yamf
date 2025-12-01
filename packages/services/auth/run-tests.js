import { runTests, withEnv } from '@yamf/test'

withEnv({
  ADMIN_USER: 'testadmin',
  ADMIN_SECRET: 'testsecret123',
  MICRO_REGISTRY_URL: 'http://localhost:20000'
}, async () => {
  const authTests = await import('./auth-tests.js')
  await runTests(authTests)
  .then(() => {
    process.exit(0)
  }).catch(err => {
    process.exit(err.code || 1)
  })
})
