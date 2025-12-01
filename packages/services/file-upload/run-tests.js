import { runTests, withEnv } from '@yamf/test'

withEnv({
  YAMF_REGISTRY_URL: 'http://localhost:20000'
}, async () => {
  const fileUploadTests = await import('./file-upload-tests.js')
  await runTests(fileUploadTests)
  .then(() => {
    process.exit(0)
  }).catch(err => {
    process.exit(err.code || 1)
  })
})
