import { createService, createRoute } from '@yamf/core'

await createRoute('/', 'simple-service')
await createRoute('/health', () => 'OK')
