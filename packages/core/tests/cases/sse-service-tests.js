/**
 * SSE Service Tests
 * Tests for createSSEService functionality
 */

import http from 'node:http'
import {
  assert,
  assertErr,
  terminateAfter,
  sleep
} from '@yamf/test'

import {
  registryServer,
  createService,
  createSSEService,
  publishMessage,
  Logger
} from '../../src/index.js'

const logger = new Logger()

/**
 * Helper: connect to an SSE endpoint and collect events
 * Returns an object with collected events and a cleanup function
 */
function connectSSE(url) {
  return new Promise((resolve, reject) => {
    const events = []
    const parsedUrl = new URL(url)


    let requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' }
    }

    const req = http.request(requestOptions, (res) => {
      let buffer = ''

      res.on('data', (chunk) => {
        buffer += chunk.toString()
        // Parse complete SSE messages (double newline delimited)
        const parts = buffer.split('\n\n')
        buffer = parts.pop()
        for (const part of parts) {
          if (!part.trim()) continue
          const event = parseSSEMessage(part)
          if (event) events.push(event)
        }
      })

      res.on('end', () => {
        // Parse any remaining buffer
        if (buffer.trim()) {
          const event = parseSSEMessage(buffer)
          if (event) events.push(event)
        }
      })

      resolve({
        events,
        response: res,
        close: () => {
          res.destroy()
          req.destroy()
        }
      })
    })

    req.on('error', reject)
    req.end()
  })
}

function parseSSEMessage(text) {
  const lines = text.split('\n')
  const event = {}
  for (const line of lines) {
    if (line.startsWith(': ')) {
      event.comment = line.slice(2)
    } else if (line.startsWith('event: ')) {
      event.event = line.slice(7)
    } else if (line.startsWith('data: ')) {
      const raw = line.slice(6)
      try { event.data = JSON.parse(raw) } catch { event.data = raw }
    } else if (line.startsWith('id: ')) {
      event.id = line.slice(4)
    }
  }
  if (Object.keys(event).length === 0) return null
  return event
}

/**
 * Test basic SSE service creation and registration
 */
export async function testSSEServiceCreation() {
  await terminateAfter(
    registryServer(),
    async () => {
      const sse = await createSSEService('test-sse', {
        onConnect: async (client) => {
          client.send('welcome', { message: 'hello' })
        }
      }, { accessControl: 'private' })

      await assert(sse,
        s => typeof s.terminate === 'function',
        s => typeof s.broadcast === 'function',
        s => typeof s.getClients === 'function',
        s => typeof s.sendTo === 'function',
        s => s.name === 'test-sse',
        s => s.type === 'sse-service',
        s => typeof s.location === 'string'
      )

      await sse.terminate()
    }
  )
}

/**
 * Test client connects and receives events
 */
export async function testSSEClientConnection() {
  await terminateAfter(
    await registryServer(),
    await createSSEService('connect-sse', {
      onConnect: async (client) => {
        client.send('greeting', { text: 'welcome' })
      }
    }, { accessControl: 'private' }),
    async (registry, sse) => {
      const { events, close } = await connectSSE(sse.location)

      // Wait for the welcome event to arrive
      await sleep(100)

      await assert(events,
        e => e.length >= 1,
        e => e[1].event === 'greeting',
        e => e[1].data.text === 'welcome'
      )

      // Check getClients reports the connection
      const clients = sse.getClients()
      await assert(clients,
        c => c.length === 1,
        c => typeof c[0].id === 'string',
        c => typeof c[0].connectedAt === 'number'
      )

      close()
      await sleep(50)

      // After disconnect, getClients should be empty
      const clientsAfter = sse.getClients()
      await assert(clientsAfter, c => c.length === 0)
    }
  )
}

/**
 * Test broadcast sends to all connected clients
 */
export async function testSSEBroadcast() {
  await terminateAfter(
    await registryServer(),
    await createSSEService('broadcast-sse', {}, { accessControl: 'private' }),
    async (registry, sse) => {

      // Connect two clients
      const client1 = await connectSSE(sse.location)
      const client2 = await connectSSE(sse.location)

      await sleep(50)

      // Broadcast an event
      const sent = sse.broadcast('update', { version: 42 })
      await assert(sent, s => s === 2)

      await sleep(100)

      await assert(client1.events,
        e => e.some(ev => ev.event === 'update' && ev.data.version === 42)
      )
      await assert(client2.events,
        e => e.some(ev => ev.event === 'update' && ev.data.version === 42)
      )

      client1.close()
      client2.close()
    }
  )
}

/**
 * Test sendTo targets a specific client
 */
export async function testSSESendTo() {
  await terminateAfter(
    await registryServer(),
    await createSSEService('sendto-sse', {}, { accessControl: 'private' }),
    async (registry, sse) => {

      const client1 = await connectSSE(sse.location)
      const client2 = await connectSSE(sse.location)

      await sleep(50)

      const clients = sse.getClients()
      await assert(clients, c => c.length === 2)

      // Send to first client only
      const targetId = clients[0].id
      sse.sendTo(targetId, 'private-msg', { secret: true })

      await sleep(100)

      await assert(client1.events,
        e => e.some(ev => ev.event === 'private-msg') ||
             client2.events.some(ev => ev.event === 'private-msg'),
      )

      // At least one client should NOT have the event (the non-targeted one)
      const client1HasMsg = client1.events.some(ev => ev.event === 'private-msg')
      const client2HasMsg = client2.events.some(ev => ev.event === 'private-msg')
      await assert([client1HasMsg, client2HasMsg],
        ([a, b]) => (a && !b) || (!a && b)
      )

      client1.close()
      client2.close()
    }
  )
}

/**
 * Test onDisconnect callback fires
 */
export async function testSSEOnDisconnect() {
  const disconnected = []
  await terminateAfter(
    await registryServer(),
    await createSSEService('disconnect-sse', {
      onDisconnect: async (clientId) => {
        disconnected.push(clientId)
      }
    }, { accessControl: 'private' }),
    async (registry, sse) => {

      const { close } = await connectSSE(sse.location)
      await sleep(50)

      const clients = sse.getClients()
      const clientId = clients[0].id

      // Disconnect
      close()
      await sleep(100)

      await assert(disconnected,
        d => d.length === 1,
        d => d[0] === clientId
      )
    }
  )
}

/**
 * Test heartbeat keeps connection alive
 */
export async function testSSEHeartbeat() {
  await terminateAfter(
    await registryServer(),
    await createSSEService('heartbeat-sse', {}, {
      accessControl: 'private',
      heartbeatInterval: 100
    }),
    async (registry, sse) => {
      const { events, response, close } = await connectSSE(sse.location)

      // Collect raw data to check for heartbeat comments
      const rawChunks = []
      response.on('data', (chunk) => {
        rawChunks.push(chunk.toString())
      })

      // Wait for at least one heartbeat
      await sleep(250)

      const allRaw = rawChunks.join('')
      await assert(allRaw,
        r => r.includes(': heartbeat')
      )

      close()
    }
  )
}

/**
 * Test pubsub channel forwarding to SSE clients
 */
// testSSEPubsubForwarding.solo = true // TODO debug this
// TODO: the publish seems to break due to the http-server being in stream mode
export async function testSSEPubsubForwarding() {
  await terminateAfter(
    await registryServer(),
    await createSSEService('pubsub-sse', {
      channels: {
        'item.created': (data, clients) => {
          clients.forEach(c => c.send('item-created', data))
        }
      }
    }, { accessControl: 'private' }),
    async (registry, sse) => {
      const { events, close } = await connectSSE(sse.location)
      await sleep(200)

      // Publish an event through pubsub
      let { results } = await publishMessage('item.created', { id: 123, name: 'Widget' })

      await sleep(200)

      await assert(events,
        e => e.length >= 1,
        e => e[0].event === 'start',
        e => e[0].data.message === 'Connection established',
        e => e.some(ev => ev.event === 'item-created' && ev.data?.id === 123)
      )

      close()
    }
  )
}

/**
 * Test non-SSE request returns service info
 */
export async function testSSENonEventStreamRequest() {
  await terminateAfter(
    await registryServer(),
    await createSSEService('info-sse', {}, { accessControl: 'private' }),
    async (registry, sse) => {
      // Make a normal POST request (not SSE)
      const result = await new Promise((resolve, reject) => {
        const url = new URL(sse.location)
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
 * Test SSE service rejects pure/local access control
 */
export async function testSSERejectsPureAccessControl() {
  await terminateAfter(
    await registryServer(),
    async () => {
      await assertErr(
        () => createSSEService('pure-sse', {}, { accessControl: 'pure' }),
        err => err.message.includes('cannot use "pure"')
      )

      await assertErr(
        () => createSSEService('local-sse', {}, { accessControl: 'local' }),
        err => err.message.includes('cannot use "local"')
      )
    }
  )
}

/**
 * Test context rebuild preserves SSE connections
 */
export async function testSSEContextRebuildPreservesConnections() {
  await terminateAfter(
    await registryServer(),
    await createSSEService('ctx-sse', {}, { accessControl: 'private' }),
    async (registry, sse) => {

      // Connect a client
      const { events, close } = await connectSSE(sse.location)
      await sleep(50)

      await assert(sse.getClients(), c => c.length === 1)

      // Register a new service -- this triggers a cache update and context rebuild
      await terminateAfter(
        await createService('helper-for-ctx-test', async () => ({ ok: true })),
        async () => {
          await sleep(100)

          // SSE client should still be connected
          await assert(sse.getClients(), c => c.length === 1)

          // Should still be able to send events
          sse.broadcast('post-rebuild', { still: 'connected' })
          await sleep(100)

          await assert(events,
            e => e.some(ev => ev.event === 'post-rebuild' && ev.data.still === 'connected')
          )

          close()
        }
      )
    }
  )
}

/**
 * Test SSE service graceful termination closes client connections
 */
export async function testSSEGracefulTermination() {

  let connectionEnded = false
  await terminateAfter(
    await registryServer(),
    await createSSEService('term-sse', {}, { accessControl: 'private' }),
    async (registry, sse) => {
      const { events, response, close } = await connectSSE(sse.location)
      await sleep(50)
      response.on('end', () => { connectionEnded = true })
    }
  )


  await sleep(100)
  await assert(connectionEnded, ended => ended === true)
}
