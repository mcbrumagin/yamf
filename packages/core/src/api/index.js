/**
 * @yamf/core API
 * Public API functions for service creation and communication
 */

// NOTE: need periodic parity-checks for other language apis
export { default as createService, createServices } from './create-service.js'
export { default as createSubscriptionService } from './create-subscription-service.js'
export { default as createEventSourceService } from './create-event-source-service.js'
export { default as createRoute, createRoutes } from './create-route.js'
export { default as callService } from './call-service.js'
export { default as callRoute } from './call-route.js'
export { default as publishMessage } from './publish-message.js'
export { createSsrHandlerRegistry } from '../service/ssr-handler-registry.js'
