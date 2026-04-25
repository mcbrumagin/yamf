/**
 * @see README.md
 */
export default {
  root: '.',
  services: [
    { name: 'minimal-api', entry: 'src/api-service.mjs', replicas: 1 }
  ],
  build: {
    external: ['@yamf/*'],
    target: 'node20',
    sourcemap: true
  }
}
