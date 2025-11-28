import { assert, assertErr, terminateAfter, withEnv } from '../core/index.js'

import {
  registryServer,
  createRoute,
  createRoutes,
  createService,
  HttpError,
  Logger,
  HEADERS,
  COMMANDS,
  gatewayServer
} from '../../src/index.js'

const logger = new Logger()

export async function testBasicRoute() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/hello', async function helloService() {
      return 'Hello World!'
    }),
    async () => {
      // Test direct HTTP request to route - no special headers needed!
      let response = await fetch(`${process.env.MICRO_REGISTRY_URL}/hello`)
      let result = await response.text()
      
      await assert(result, r => r === 'Hello World!')
      await assert(response.status, s => s === 200)
    }
  )
}

export async function testRouteWithService() {
  await terminateAfter(
    await registryServer(),
    await createService('greetingService', function greetingService(payload) {
      return `Hello ${payload.name || 'World'}!`
    }),
    async () => {
      await createRoute('/greet', 'greetingService')

      let response = await fetch(`${process.env.MICRO_REGISTRY_URL}/greet`)
      let result = await response.text()
      
      await assert(result, r => r.includes('Hello World!'))
    }
  )
}


export async function testRouteWithServiceThroughGateway() {
  await withEnv({
    MICRO_GATEWAY_URL: 'http://localhost:15000'
  }, async () => await terminateAfter(
    await registryServer(),
    await gatewayServer(),
    await createService('greetingService', function greetingService(payload) {
      return `Hello ${payload.name || 'World'}!`
    }),
    async () => {
      await createRoute('/greet', 'greetingService')

      let response = await fetch(`${process.env.MICRO_GATEWAY_URL}/greet`)
      let result = await response.text()
      
      await assert(result, r => r.includes('Hello World!'))
    }
  ))
}

export async function testRouteBulkCreate() {
  await terminateAfter(
    await registryServer(),
    await createService('greetingService', function greetingService(payload) {
      return `Hello ${payload.name || 'World'}!`
    }),
    await createService('greetingService2', function greetingService2(payload) {
      return `Well g'day then, ${payload.name || 'World'}!`
    }),
    async () => {
      await createRoutes({
        '/greet': 'greetingService',
        '/greet2': 'greetingService',
        '/greet3': 'greetingService2'
      })

      let result1 = await (await fetch(`${process.env.MICRO_REGISTRY_URL}/greet`)).text()
      let result2 = await (await fetch(`${process.env.MICRO_REGISTRY_URL}/greet2`)).text()

      let requestPayloadOptions = {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ name: 'John' })
      }

      let result3 = await (await fetch(`${process.env.MICRO_REGISTRY_URL}/greet3`, requestPayloadOptions)).text()
      
      await assert([result1, result2, result3],
        ([r1, r2,   ]) => r1 === r2,
        ([  ,  ,  r3]) => r3 === `Well g'day then, John!`
      )
    }
  )
}


export async function testRouteInlineServiceCreation() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/greet', function greetingService(payload) {
      return `Hello ${payload.name || 'World'}!`
    }),
    async () => {
      let result = await (await fetch(`${process.env.MICRO_REGISTRY_URL}/greet`)).text()
      await assert(result, r => r.includes(`Hello World!`))
    }
  )
}

export async function testRouteControllerWildcard() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/api/*', async function apiController(payload, request) {
      return { path: request.url, message: 'API response' }
    }),
    async () => {
      let response = await fetch(`${process.env.MICRO_REGISTRY_URL}/api/users`)
      let result = await response.text()
      let parsed = JSON.parse(result)
      
      await assert(parsed,
        p => p.path === '/api/users',
        p => p.message === 'API response'
      )
    }
  )
}


export async function testRouteControllerWildcardThroughGateway() {
  await withEnv({
    MICRO_GATEWAY_URL: 'http://localhost:15000'
  }, async () => await terminateAfter(
    await registryServer(),
    await gatewayServer(),
    await createRoute('/api/*', async function apiController(payload, request) {
      return { path: request.url, message: 'API response' }
    }),
    async () => {
      let response = await fetch(`${process.env.MICRO_GATEWAY_URL}/api/users`)
      let result = await response.text()
      let parsed = JSON.parse(result)
      
      await assert(parsed,
        p => p.path === '/api/users',
        p => p.message === 'API response'
      )
    }
  ))
}

export async function testRouteMissingService() {
  await terminateAfter(
    await registryServer(),
    await createRoute('/broken', 'nonExistentService'),
    async () => {

      await assertErr(
        async () => {
          let response = await fetch(`${process.env.MICRO_REGISTRY_URL}/broken`)
          if (response.status >= 400 && response.status < 600) {
            throw new HttpError(response.status, await response.text())
          } else return await response.text()
        },
        err => err.message.includes('No service by name "nonExistentService"')
      )
    }
  )
}

export async function testRouteValidation() {
  await terminateAfter(
    await registryServer(),
    async () => {
      await assertErr(
        async () => createRoute('', 'someService'),
        err => err.message.includes('Route path and service fn or name are required')
      )
      
      await assertErr(
        async () => createRoute('/test', ''),
        err => err.message.includes('Route path and service fn or name are required')
      )
    }
  )
}
