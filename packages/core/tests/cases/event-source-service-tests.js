/**
 * EventService Service Tests
 * Tests for createEventSourceService functionality
 */

import http from 'node:http'
import {
  assert,
  assertEach,
  assertErr,
  terminateAfter,
  sleep
} from '@yamf/test'

import {
  subscribeToEventSource
} from '@yamf/client'

import {
  registryServer,
  createService,
  createEventSourceService,
  publishMessage,
  Logger
} from '../../src/index.js'

const logger = new Logger()

/**
 * Test basic EventSourceService service creation and registration
 */
export async function testEventSourceServiceCreation() {
  await terminateAfter(
    registryServer(),
    await createEventSourceService('test-sse', {
      onConnect: async (client) => {
        client.send('welcome', { message: 'hello' })
      }
    }, { accessControl: 'private' }),
    async (registry, service) => {

      await assert(service,
        s => typeof s.terminate === 'function',
        s => typeof s.broadcast === 'function',
        s => typeof s.getClients === 'function',
        s => typeof s.sendTo === 'function',
        s => s.name === 'test-sse',
        s => s.type === 'sse-service',
        s => typeof s.location === 'string'
      )
    }
  )
}

/**
 * Test client connects and receives events
 */
export async function testEventSourceClientConnection() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('connect-sse', {
      onConnect: async (client) => {
        client.send('greeting', { text: 'welcome' })
      }
    }, { accessControl: 'private' }),
    async (registry, service) => {

      const events = []
      const client = await subscribeToEventSource(service.location, event => events.push(event))

      // Wait for the welcome event to arrive
      await sleep(100)

      await assert(events,
        e => e.length >= 1,
        e => e[1].event === 'greeting',
        e => e[1].data.text === 'welcome'
      )

      // Check getClients reports the connection
      const clients = service.getClients()
      await assert(clients,
        c => c.length === 1,
        c => typeof c[0].id === 'string',
        c => typeof c[0].connectedAt === 'number'
      )

      client.close()
      await sleep(50)

      // After disconnect, getClients should be empty
      const clientsAfter = service.getClients()
      await assert(clientsAfter, c => c.length === 0)
    }
  )
}

/**
 * Test broadcast sends to all connected clients
 */
export async function testEventSourceBroadcast() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('broadcast-sse', {}, { accessControl: 'private' }),
    async (registry, service) => {

      // Connect two clients

      const client1Events = []
      const client2Events = []
      const client1 = await subscribeToEventSource(service.location, event => client1Events.push(event))
      const client2 = await subscribeToEventSource(service.location, event => client2Events.push(event))

      await sleep(50)

      // Broadcast an event
      const sent = service.broadcast('update', { version: 42 })
      await assert(sent, s => s === 2)

      await sleep(100)

      await assert(client1Events,
        e => e.length >= 1,
        e => e[1].event === 'update',
        e => e[1].data.version === 42
      )
      await assert(client2Events,
        e => e.length >= 1,
        e => e[1].event === 'update',
        e => e[1].data.version === 42
      )

      client1.close()
      client2.close() 
    }
  )
}

/**
 * Test sendTo targets a specific client
 */
export async function testEventSourceSendTo() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('sendto-sse', {}, { accessControl: 'private' }),
    async (registry, service) => {

      const client1Events = []
      const client2Events = []
      const client1 = await subscribeToEventSource(service.location, event => client1Events.push(event))
      const client2 = await subscribeToEventSource(service.location, event => client2Events.push(event))

      await sleep(50)

      const clients = service.getClients()
      await assert(clients, c => c.length === 2)

      // Send to first client only
      const targetId = clients[0].id
      service.sendTo(targetId, 'private-msg', { secret: true })

      await sleep(200)

      await assertEach([client1Events, client2Events],
        e => e.some(ev => ev.event === 'start'))

      // At least one client should NOT have the event (the non-targeted one)
      const client1HasMsg = client1Events.some(ev => ev.event === 'private-msg')
      const client2HasMsg = client2Events.some(ev => ev.event === 'private-msg')
      await assert([client1HasMsg, client2HasMsg],
        ([a, b]) => (a && !b) || (!a && b)
      )

      client1.close()
      client2.close()
    }
  )
}


export async function testIsomorphicClientSubscribeToEventSourceService() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('sendto-sse', {}, { accessControl: 'private' }),
    async (registry, service) => {

      const events = []
      const client = await subscribeToEventSource(service.location, event => events.push(event))

      await sleep(100)

      service.broadcast('payload', { pay: 'load' }, 1)

      await sleep(200)

      await assert(events,
        e => e.some(ev => ev.id === '1'),
        e => e.some(ev => ev.event === 'payload'),
        e => e.some(ev => ev.data?.pay === 'load'),
      )

      client.close()
    }
  )
}


export async function testIsomorphicClientSubscribeToEventSourceServiceMap() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('sendto-sse', {}, { accessControl: 'private' }),
    async (registry, service) => {

      const events = []
      const client = await subscribeToEventSource(service.location, {
        event1: event => events.push(event),
        event2: event => events.push(event)
      })

      await sleep(100)

      service.broadcast('event1', { pay: 'load1' }, 1)
      service.broadcast('event2', { pay: 'load2' }, 2)

      await sleep(200)

      await assert(events,
        e => e.some(ev => ev.id === '1'),
        e => e.some(ev => ev.id === '2'),
        e => e.some(ev => ev.event === 'event1'),
        e => e.some(ev => ev.event === 'event2'),
        e => e.some(ev => ev.data.pay === 'load1'),
        e => e.some(ev => ev.data.pay === 'load2'),
      )

      client.close()
    }
  )
}

/**
 * Test onDisconnect callback fires
 */
export async function testEventSourceOnDisconnect() {
  const disconnected = []
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('disconnect-sse', {
      onDisconnect: async (clientId) => {
        disconnected.push(clientId)
      }
    }, { accessControl: 'private' }),
    async (registry, service) => {

      const events = []
      const client = await subscribeToEventSource(service.location, event => events.push(event))

      await sleep(50)

      const clients = service.getClients()
      const clientId = clients[0].id

      // Disconnect
      client.close()
      await sleep(100)

      await assert(disconnected,
        d => d.length === 1,
        d => d[0] === clientId
      )
    }
  )
}


/**
 * Test pubsub channel forwarding to EventSource clients
 */

export async function testEventSourcePubsubForwarding() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('pubsub-sse', {
      channels: {
        'item:created': (data, clients) => {
          clients.forEach(c => c.send('item-created', data))
        }
      }
    }, { accessControl: 'private' }),
    async (registry, service) => {
      const events = []
      const client = await subscribeToEventSource(service.location, event => events.push(event))
      await sleep(200)

      // Publish an event through pubsub
      let { results } = await publishMessage('item:created', { id: 123, name: 'Widget' })

      await sleep(200)

      await assert(events,
        e => e.length >= 1,
        e => e[0].event === 'start',
        e => e[0].data === undefined,
        e => e.some(ev => ev.event === 'item-created' && ev.data?.id === 123)
      )

      client.close()
    }
  )
}

/**
 * Test non-EventSource request returns service info
 */
export async function testEventSourceNonEventStreamRequest() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('info-sse', {}, { accessControl: 'private' }),
    async (registry, service) => {
      // Make a normal POST request (not EventSource)
      const result = await new Promise((resolve, reject) => {
        const url = new URL(service.location)
        const req = http.request({
          hostname: url.hostname,
          port: url.port,
          path: '/',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => {
            try { resolve(JSON.parse(data)) } catch { resolve(data) }
          })
        })
        req.on('error', reject)
        req.write('{}')
        req.end()
      })

      await assert(result,
        r => r.service === 'info-sse',
        r => r.type === 'sse-service',
        r => typeof r.clients === 'number'
      )
    }
  )
}

/**
 * Test EventSource service rejects pure/local access control
 */
export async function testEventSourceRejectsPureAccessControl() {
  await terminateAfter(
    await registryServer(),
    async () => {
      await assertErr(
        () => createEventSourceService('pure-sse', {}, { accessControl: 'pure' }),
        err => err.message.includes('cannot use "pure"')
      )

      await assertErr(
        () => createEventSourceService('local-sse', {}, { accessControl: 'local' }),
        err => err.message.includes('cannot use "local"')
      )
    }
  )
}

/**
 * Test context rebuild preserves EventSource connections
 */
export async function testEventSourceContextRebuildPreservesConnections() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('ctx-sse', {}, { accessControl: 'private' }),
    async (registry, service) => {

      // Connect a client
      const events = []
      const client = await subscribeToEventSource(service.location, event => events.push(event))
      await sleep(50)

      await assert(service.getClients(), c => c.length === 1)

      // Register a new service -- this triggers a cache update and context rebuild
      await terminateAfter(
        await createService('helper-for-ctx-test', async () => ({ ok: true })),
        async () => {
          await sleep(100)

          // EventSource client should still be connected
          await assert(service.getClients(), c => c.length === 1)

          // Should still be able to send events
          service.broadcast('post-rebuild', { still: 'connected' })
          await sleep(100)

          await assert(events,
            e => e.some(ev => ev.event === 'post-rebuild' && ev.data.still === 'connected')
          )

          client.close()
        }
      )
    }
  )
}

/**
 * Test EventSource service graceful termination closes client connections
 */
export async function testEventSourceGracefulTermination() {
  await terminateAfter(
    await registryServer(),
    await createEventSourceService('term-sse', {}, { accessControl: 'private' }),
    async (registry, service) => {
      const events = []
      const client = await subscribeToEventSource(service.location, event => events.push(event))
      await sleep(200)
      client.close()

      await sleep(100)

      await assert(service.getClients(), c => c.length === 0)
    }
  )
}
