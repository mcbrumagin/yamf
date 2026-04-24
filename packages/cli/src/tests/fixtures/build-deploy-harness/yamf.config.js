/**
 * Test fixture for `cli-build-deploy-tests.js` — loaded by `yamf build` (cwd = this directory).
 * Service name must match `createService` in `service-entry.js` for `replicaMetadata` / deploy.
 */
export default {
  root: '.',
  services: [
    {
      name: 'deploy-int-svc',
      entry: 'service-entry.js',
      replicas: 1
    }
  ],
  build: {
    external: ['@yamf/*'],
    target: 'node20',
    sourcemap: false
  }
}
