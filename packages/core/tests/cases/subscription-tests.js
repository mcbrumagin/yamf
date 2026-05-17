/**
 * Subscription Service Tests
 * Tests for createSubscriptionService functionality
 */

import {
  assert,
  assertErr,
  terminateAfter,
  sleep
} from '@yamf/test'

import {
  registryServer,
  createService,
  callService,
  createSubscriptionService,
  publishMessage,
  Logger
} from '../../src/index.js'

const logger = new Logger()

/**
 * Test basic subscription creation and message delivery
 */
export async function testBasicSubscription() {
  await terminateAfter(async () => {
    await registryServer()
    const messages = []
    
    const subscription = await createSubscriptionService('test-subscription', {
      'test-channel': async (message) => {
        messages.push(message)
        return { received: true }
      }
    })
    
    // Publish a message
    await publishMessage('test-channel', { data: 'test message 1' })
    
    await assert(messages,
      m => m.length === 1,
      m => m[0].data === 'test message 1'
    )
    
    // Publish another message
    await publishMessage('test-channel', { data: 'test message 2' })
    
    await assert(messages,
      m => m.length === 2,
      m => m[1].data === 'test message 2'
    )
    
    // Verify subscription object structure
    await assert(subscription,
      s => typeof s.terminate === 'function',
      s => Array.isArray(s.channels),
      s => s.channels.includes('test-channel'),
      s => typeof s.location === 'string',
      s => typeof s.name === 'string',
      s => s.name === 'test-subscription'
    )
    
    await subscription.terminate()
  })
}

/**
 * Test multiple subscription services to the same channel
 */
export async function testMultipleSubscriptionsToSameChannel() {
  await terminateAfter(async () => {
    await registryServer()

    const messages1 = []
    const messages2 = []
    
    await createSubscriptionService('sub1', {
      'shared-channel': async (message) => {
        messages1.push(message)
      }
    })
    
    await createSubscriptionService('sub2', {
      'shared-channel': async (message) => {
        messages2.push(message)
      }
    })
    
    // Publish a message - both should receive it
    await publishMessage('shared-channel', { data: 'broadcast' })
    
    await assert([messages1, messages2],
      ([m1, m2]) => m1.length === 1,
      ([m1, m2]) => m2.length === 1,
      ([m1, m2]) => m1[0].data === 'broadcast',
      ([m1, m2]) => m2[0].data === 'broadcast'
    )
  })
}

/**
 * Test subscription service with multiple channels
 */
export async function testMultipleChannelSubscriptions() {
  await terminateAfter(async () => {
    await registryServer()

    const channelAMessages = []
    const channelBMessages = []
      
    // throw new Error('test')
    await createSubscriptionService('multi-channel-sub', {
      'channel-a': async (message) => {
        channelAMessages.push(message)
      },
      'channel-b': async (message) => {
        channelBMessages.push(message)
      }
    })
    
    // Publish to different channels
    await publishMessage('channel-a', { source: 'A' })
    await publishMessage('channel-b', { source: 'B' })
    
    await assert([channelAMessages, channelBMessages],
      ([a, b]) => a.length === 1,
      ([a, b]) => b.length === 1,
      ([a, b]) => a[0].source === 'A',
      ([a, b]) => b[0].source === 'B'
    )
  })
}

/**
 * Test subscription termination stops message delivery
 */
export async function testSubscriptionTermination () {
  await terminateAfter(async () => {
    await registryServer()
    const messages = []

    const subscription = await createSubscriptionService('term-service', {
      'term-channel': async (message) => { messages.push(message) }
    })

    await publishMessage('term-channel', { id: 1 })
    await subscription.terminate() // prevents the second message from being delivered
    await publishMessage('term-channel', { id: 2 })

    await assert(messages,
      m => m.length === 1,
      m => m[0].id === 1
    )
  })
}

/**
 * Channel-map validation is synchronous and runs before any registry I/O — these tests
 * therefore need no `terminateAfter` / `registryServer`.
 */
export async function testInvalidHandler () {
  await assertErr(
    async () => createSubscriptionService('test-service', { 'test-channel': 'not-a-function' }),
    err => err.message.includes('must be a function')
  )

  await assertErr(
    async () => createSubscriptionService('test-service2', { 'test-channel': null }),
    err => err.message.includes('must be a function')
  )

  await assertErr(
    async () => createSubscriptionService('test-service3', {}),
    err => err.message.includes('at least one channel')
  )
}

export async function testRejectsLegacyStringChannelOverload () {
  await assertErr(
    async () => createSubscriptionService('legacy', 'some-channel', () => 'x'),
    err => err.message.includes('pass a channel map'),
    err => err.message.includes('{ [channel]: handler }')
  )
}

export async function testRejectsEmptyServiceName () {
  await assertErr(
    async () => createSubscriptionService('', { foo: () => null }),
    err => err.message.toLowerCase().includes('servicename'),
    err => err.message.includes('non-empty string')
  )
}

export async function testRejectsArrayChannelMap () {
  await assertErr(
    async () => createSubscriptionService('arr', [() => null]),
    err => err.message.includes('object of { channel: handler }')
  )
}

/**
 * Test subscription handler error is caught and logged
 */
export async function testSubscriptionHandlerError() {
  await terminateAfter(async () => {
    await registryServer()
    
    await createSubscriptionService('error-service', {
      'error-channel': async (message) => {
        if (message.shouldError) {
          throw new Error('Intentional handler error')
        }
        return { success: true }
      }
    })
    
    let publishResult = await publishMessage('error-channel', { shouldError: true })
    
    assert(publishResult,
      r => r.results && r.results.length > 0,
      r => r.results[0].errors && r.results[0].errors.length > 0
    )
  })
}

/**
 * Test subscription with complex message payloads
 */
export async function testComplexMessagePayloads() {
  const messages = []
  
  await terminateAfter(
    () => registryServer(),
    () => createSubscriptionService('complex-service', {
      'complex-channel': async (message) => {
        messages.push(message)
      }
    }),
    async () => {
      
      // Send various complex payloads
      await publishMessage('complex-channel', {
        nested: { deeply: { nested: { value: 123 } } },
        array: [1, 2, 3],
        mixed: { items: [{ id: 1 }, { id: 2 }] }
      })
      
      await publishMessage('complex-channel', {
        string: 'test',
        number: 42,
        boolean: true,
        null: null
      })
      
      assert(messages,
        m => m.length === 2,
        m => m[0].nested.deeply.nested.value === 123,
        m => m[0].array.length === 3,
        m => m[0].mixed.items[1].id === 2,
        m => m[1].string === 'test',
        m => m[1].number === 42,
        m => m[1].boolean === true,
        m => m[1].null === null
      )
    }
  )
}

/**
 * Test subscription publish results
 */
export async function testSubscriptionPublishResults() {
  await terminateAfter(
    () => registryServer(),
    () => createSubscriptionService('rpc-service', {
      'rpc-channel': async (message) => {
        return { echo: message, processed: true }
      }
    }),
    async () => {
      
      // Publish returns results from all handlers
      const result = await publishMessage('rpc-channel', { test: 'data' })
      
      assert(result,
        r => r.results.length === 1,
        r => r.results[0].results[0].echo.test === 'data',
        r => r.results[0].results[0].processed === true
      )
    }
  )
}

/**
 * Test concurrent message handling
 */
export async function testConcurrentMessages() {
  const messages = []
  
  await terminateAfter(
    () => registryServer(),
    () => createSubscriptionService('concurrent-service', {
      'concurrent-channel': async (message) => {
        await sleep(10) // Simulate async processing
        messages.push(message.id)
      }
    }),
    async () => {
      // Send multiple messages concurrently
      const promises = []
      for (let i = 0; i < 5; i++) {
        promises.push(publishMessage('concurrent-channel', { id: i }))
      }
      
      await Promise.all(promises)
      
      assert(messages,
        m => m.length === 5,
        m => new Set(m).size === 5, // All unique IDs received
        m => m.includes(0) && m.includes(4) // First and last received
      )
    }
  )
}

/**
 * Test subscription receives messages from start
 */
export async function testSubscriptionStartsClean() {
  const messages = []
  
  await terminateAfter(
    () => registryServer(),
    async () => {
      // Publish before subscription exists
      await publishMessage('clean-channel', { id: 0 })
      
      const subscription = await createSubscriptionService('clean-service', {
        'clean-channel': async (message) => {
          messages.push(message)
        }
      })
      
      // Should not receive the message sent before subscription
      await assert(messages, m => m.length === 0)
      
      // But should receive new messages
      await publishMessage('clean-channel', { id: 1 })
      
      assert(messages,
        m => m.length === 1,
        m => m[0].id === 1
      )
      
      await subscription.terminate()
    }
  )
}
