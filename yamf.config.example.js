/**
 * Example manifest for `yamf build` / `yamf deploy --local` (Phase 2).
 * Copy to `yamf.config.js` in your app repo root and adjust entries.
 */
export default {
  root: '.',
  services: [
    { name: 'registry', entry: 'src/registry.js', replicas: 1, internal: true },
    { name: 'auth-service', entry: 'src/services/auth.js', replicas: 1, env: ['ADMIN_USER', 'ADMIN_PASS'] }
  ],
  build: {
    external: ['@yamf/*'],
    target: 'node20',
    sourcemap: true
  }
}
