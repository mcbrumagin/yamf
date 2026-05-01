/**
 * Example manifest for `yamf build` / `yamf deploy --local` (Phase 2).
 * Copy to `yamf.config.js` in your app repo root and adjust entries.
 */
export default {
  root: '.',
  services: [
    { name: 'registry', entry: 'src/registry.js', replicas: 1, internal: true },
    {
      name: 'api',
      entry: 'src/server.js',
      replicas: 1,
      /** When `createService('my-api')` uses a different name than the manifest `name`, set this so REGISTRY_PULL / deploy agree. */
      registeredServiceName: 'my-api',
      /** Extra paths (relative to `root`) for `yamf dev` to watch beyond the entry file’s directory. */
      watch: ['src/shared'],
      env: ['DATABASE_URL']
    },
    { name: 'auth', entry: 'src/services/auth.js', replicas: 1, env: ['ADMIN_USER', 'ADMIN_PASS'] }
  ],
  build: {
    external: ['@yamf/*'],
    target: 'node20',
    sourcemap: true,
    /** `external` (default): keep `node_modules` out of the bundle. `bundle`: single-file output. */
    packages: 'external'
  }
}
