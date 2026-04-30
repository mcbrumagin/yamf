/**
 * @yamf/core
 * Main entrypoint to @yamf/core services
 */

// Public API
export * from './api/index.js'

// Gateway Server
export { default as gatewayServer } from './gateway/gateway-server.js'

// Registry Server
export { default as registryServer } from './registry/registry-server.js'
/** @internal For tests and in-process use with registry `state` from `server._state`. Prefer `server.registerCommand` on the instance from {@link registryServer}. */
export { registerCommand, unregisterCommand } from './registry/command-router.js'

// HTTP Primitives
export * from './http-primitives/index.js'

export { default as Logger, overrideConsoleGlobally } from './utils/logger.js'
export { loadOrCreateEd25519KeyPair } from './utils/load-or-create-ed25519-keypair.js'

export * from './shared/yamf-headers.js'
export { lifecycle } from './shared/process-lifecycle.js'

// Shared utilities (also exported from main index for convenience)
export { envConfig } from './shared/index.js'
export { buildCsp, getDefaultResponseSecurityHeaders } from './shared/csp.js'

export * from './shared/crypto.js'

// Registry helpers (C3 / deploy)
export { deployDecisionFromReplicas } from './registry/deploy-decision.js'
export { createBundleStore, streamBundleToFileWithHashCheck } from './registry/bundle-store.js'
export {
  loadDeployAuthorizedPublicKeyObjectsFromDisk,
  verifyEd25519SignatureOnDeployHash,
  enforceDeployBundleEd25519Policy,
  signDeployHashWithEd25519Pem
} from './registry/deploy-bundle-signature.js'
export { getReplicasFor, listServiceLocations } from './registry/replica-helpers.js'
export { terminateActiveRegistryServers } from './registry/active-registry.js'

// Contract cross-cut 2: import from @yamf/core/contract-compatibility (not the main entry) so app
// bundles that only need createService do not load or resolve this module.

// Rate Limiter
export * from './rate-limiter/index.js'
