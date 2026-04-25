#!/usr/bin/env node
import { gatewayServer } from '@yamf/core'

await gatewayServer()
process.on('unhandledRejection', (e) => {
  console.error(e)
  process.exit(1)
})
