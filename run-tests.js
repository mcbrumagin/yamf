const envMap = {
  ENVIRONMENT: 'local',
  YAMF_REGISTRY_URL: 'http://localhost:10000',
  YAMF_REGISTRY_TOKEN: 'dev-test-token-12345',
  ADMIN_USER: 'testadmin',
  ADMIN_SECRET: 'testsecret123',
  LOG_LEVEL: 'info',
  MUTE_LOG_GROUP_OUTPUT: true,
  LOG_INCLUDE_LINES: true,
  LOG_EXCLUDE_FULL_PATH_IN_LOG_LINES: true,
  MUTE_SUCCESS_CASES: true,
}

for (let prop in envMap) {
  process.env[prop] = envMap[prop]
}

const { overrideConsoleGlobally, envConfig } = await import('./packages/core/src/index.js')
const { withEnv } = await import('./packages/test/src/index.js')

for (let prop in envMap) {
  envConfig.set(prop, envMap[prop])
}

envConfig.loadEnvironmentVariables()
overrideConsoleGlobally()

await withEnv(envMap, async () => {
  await import('./packages/core/tests/run-all-cases.js')
})
