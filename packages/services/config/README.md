# @yamf/services-config

Encrypted config store and **`config-service`** for environment-scoped key/value sets (see `service.js` and `storage.js`).

## Requirements

- **`YAMF_CONFIG_KEY`** — scrypt passphrase for encryption at rest (never commit; use strong secret in production).
- Optional **`YAMF_CONFIG_ADMIN_TOKEN`** — required for mutating admin commands when enforced by the service.

## Quick usage

Start the service from your bootstrap with `createConfigService({ adminToken, dataDir })` (see `service.js` options). Call via `callService('config-service', { command: 'list' | 'get' | 'set' | 'delete', ... })`.

Runnable smoke: `packages/services/config/config-smoke.example.js` (`yamf test --as-test '*.example.js' -d packages/services/config`).
