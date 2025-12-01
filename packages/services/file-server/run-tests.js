import { TestRunner, withEnv } from '@yamf/test'

withEnv({
  MICRO_REGISTRY_URL: 'http://localhost:20000'
}, async () => {
  const staticFileTests = await import('./tests/static-file-tests.js')
  const autorefreshTests = await import('./tests/autorefresh-tests.js')

  let runner = new TestRunner()
  
  runner.addSuites({
    staticFileTests,
    autorefreshTests
  })

  await runner.run().then(() => {
    process.exit(0)
  }).catch(err => {
    process.exit(err.code || 1)
  })
})
