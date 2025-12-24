/**
 * Access Control Tests
 * Tests for the access control mechanisms: pure, local, private, public
 */

import { assert } from '@yamf/test'

// Service state tests
import { 
  createServiceState, 
  updateCache, 
  updateCacheEntry, 
  removeFromCache,
  clearCache,
  hasService,
  getServiceLocations,
  getServiceAccess,
  serializeServicesMap,
  serializeMap
} from '../../src/service/service-state.js'

// Local state tests
import {
  localState,
  registerLocalService,
  unregisterLocalService,
  getLocalService,
  hasLocalService,
  getLocalServiceAccess,
  registerLocalSubscription,
  unregisterLocalSubscription,
  getLocalSubscriptionHandlers,
  clearLocalState
} from '../../src/shared/local-state.js'

// Registry state tests
import { createRegistryState } from '../../src/registry/registry-state.js'
import { registerService } from '../../src/registry/service-registry.js'

// --- Service State Tests (Map/Set based) ---

export async function testCreateServiceState() {
  const state = createServiceState()
  await assert(state,
    s => s.services instanceof Map,
    s => s.serviceAccess instanceof Map,
    s => s.addresses instanceof Map,
    s => s.subscriptions instanceof Map,
    s => s.services.size === 0
  )
}

export async function testUpdateCache() {
  const cache = createServiceState()
  
  updateCache(cache, {
    services: {
      'service1': ['http://localhost:3001', 'http://localhost:3002'],
      'service2': ['http://localhost:3003']
    },
    addresses: {
      'http://localhost:3001': 'service1',
      'http://localhost:3002': 'service1',
      'http://localhost:3003': 'service2'
    },
    serviceAccess: {
      'service1': 'private',
      'service2': 'public'
    }
  })
  
  await assert(cache,
    c => c.services.has('service1'),
    c => c.services.get('service1').size === 2,
    c => c.services.get('service2').size === 1,
    c => c.addresses.get('http://localhost:3001') === 'service1',
    c => c.serviceAccess.get('service1') === 'private',
    c => c.serviceAccess.get('service2') === 'public'
  )
}

export async function testUpdateCacheEntryService() {
  const cache = createServiceState()
  
  updateCacheEntry(cache, {
    subscription: 'undefined',
    service: 'myService',
    accessControl: 'private',
    location: 'http://localhost:3001'
  })
  
  await assert(cache,
    c => c.services.has('myService'),
    c => c.services.get('myService').has('http://localhost:3001'),
    c => c.addresses.get('http://localhost:3001') === 'myService',
    c => c.serviceAccess.get('myService') === 'private'
  )
}

export async function testUpdateCacheEntryExternalPure() {
  const cache = createServiceState()
  
  // Simulate receiving cache update for a pure service on another node
  updateCacheEntry(cache, {
    subscription: 'undefined',
    service: 'pureService',
    accessControl: 'pure',
    location: 'pure://local'
  })
  
  await assert(cache,
    c => c.services.has('pureService'),
    c => c.serviceAccess.get('pureService') === 'external' // Should be marked as external
  )
}

export async function testRemoveFromCache() {
  const cache = createServiceState()
  cache.services.set('svc', new Set(['loc1', 'loc2']))
  cache.addresses.set('loc1', 'svc')
  cache.addresses.set('loc2', 'svc')
  cache.serviceAccess.set('svc', 'private')
  
  removeFromCache(cache, { service: 'svc', location: 'loc1' })
  
  await assert(cache,
    c => c.services.get('svc').size === 1,
    c => !c.services.get('svc').has('loc1'),
    c => c.services.get('svc').has('loc2'),
    c => !c.addresses.has('loc1'),
    c => c.addresses.has('loc2')
  )
}

export async function testRemoveFromCacheLastLocation() {
  const cache = createServiceState()
  cache.services.set('svc', new Set(['loc1']))
  cache.addresses.set('loc1', 'svc')
  cache.serviceAccess.set('svc', 'private')
  
  removeFromCache(cache, { service: 'svc', location: 'loc1' })
  
  await assert(cache,
    c => !c.services.has('svc'),
    c => !c.addresses.has('loc1'),
    c => !c.serviceAccess.has('svc')
  )
}

export async function testClearCache() {
  const cache = createServiceState()
  cache.services.set('svc', new Set(['loc1']))
  cache.addresses.set('loc1', 'svc')
  cache.serviceAccess.set('svc', 'private')
  cache.subscriptions.set('channel', new Set(['loc1']))
  
  clearCache(cache)
  
  await assert(cache,
    c => c.services.size === 0,
    c => c.addresses.size === 0,
    c => c.serviceAccess.size === 0,
    c => c.subscriptions.size === 0
  )
}

export async function testHasServiceAndGetters() {
  const cache = createServiceState()
  cache.services.set('myService', new Set(['loc1', 'loc2']))
  cache.serviceAccess.set('myService', 'public')
  
  await assert(true,
    () => hasService(cache, 'myService') === true,
    () => hasService(cache, 'nonExistent') === false,
    () => getServiceLocations(cache, 'myService').length === 2,
    () => getServiceLocations(cache, 'nonExistent').length === 0,
    () => getServiceAccess(cache, 'myService') === 'public',
    () => getServiceAccess(cache, 'nonExistent') === undefined
  )
}

export async function testSerializeServicesMap() {
  const cache = createServiceState()
  cache.services.set('svc1', new Set(['loc1', 'loc2']))
  cache.services.set('svc2', new Set(['loc3']))
  
  const result = serializeServicesMap(cache.services)
  
  await assert(result,
    r => Array.isArray(r.svc1),
    r => r.svc1.length === 2,
    r => r.svc1.includes('loc1'),
    r => r.svc1.includes('loc2'),
    r => Array.isArray(r.svc2),
    r => r.svc2.length === 1
  )
}

// --- Local State Tests ---

export async function testLocalStateInitialization() {
  clearLocalState()
  await assert(localState,
    s => s.services instanceof Map,
    s => s.subscriptions instanceof Map,
    s => s.services.size === 0,
    s => s.subscriptions.size === 0
  )
}

export async function testRegisterLocalService() {
  clearLocalState()
  
  const mockFn = async (payload) => ({ result: payload })
  registerLocalService('testService', mockFn, 'pure')
  
  await assert(true,
    () => hasLocalService('testService') === true,
    () => getLocalService('testService') === mockFn,
    () => getLocalServiceAccess('testService') === 'pure'
  )
  
  clearLocalState()
}

export async function testUnregisterLocalService() {
  clearLocalState()
  
  const mockFn = async (payload) => ({ result: payload })
  registerLocalService('testService', mockFn, 'local')
  unregisterLocalService('testService')
  
  await assert(true,
    () => hasLocalService('testService') === false,
    () => getLocalService('testService') === null,
    () => getLocalServiceAccess('testService') === null
  )
  
  clearLocalState()
}

export async function testLocalSubscriptions() {
  clearLocalState()
  
  const handler1 = async (msg) => ({ received: msg })
  const handler2 = async (msg) => ({ processed: msg })
  
  registerLocalSubscription('my.channel', handler1)
  registerLocalSubscription('my.channel', handler2)
  
  const handlers = getLocalSubscriptionHandlers('my.channel')
  
  await assert(handlers,
    h => h instanceof Set,
    h => h.size === 2,
    h => h.has(handler1),
    h => h.has(handler2)
  )
  
  // Test unregister
  unregisterLocalSubscription('my.channel', handler1)
  const handlersAfter = getLocalSubscriptionHandlers('my.channel')
  
  await assert(handlersAfter,
    h => h.size === 1,
    h => !h.has(handler1),
    h => h.has(handler2)
  )
  
  clearLocalState()
}

export async function testGetLocalSubscriptionHandlersEmpty() {
  clearLocalState()
  
  const handlers = getLocalSubscriptionHandlers('nonexistent.channel')
  
  await assert(handlers,
    h => h instanceof Set,
    h => h.size === 0
  )
}

// --- Registry Access Control Tests ---

export async function testRegisterServicePrivate() {
  const state = createRegistryState()
  
  await registerService(state, {
    service: 'myService',
    location: 'http://localhost:3001',
    accessControl: 'private'
  })
  
  await assert(state,
    s => s.services.has('myService'),
    s => s.services.get('myService').has('http://localhost:3001'),
    s => s.serviceAccess.get('myService') === 'private'
  )
}

export async function testRegisterServicePublic() {
  const state = createRegistryState()
  
  await registerService(state, {
    service: 'publicService',
    location: 'http://localhost:3001',
    accessControl: 'public'
  })
  
  await assert(state,
    s => s.services.has('publicService'),
    s => s.serviceAccess.get('publicService') === 'public'
  )
}

export async function testRegisterServicePure() {
  const state = createRegistryState()
  
  await registerService(state, {
    service: 'pureService',
    location: 'pure://local',
    accessControl: 'pure'
  })
  
  await assert(state,
    s => s.services.has('pureService'),
    s => s.serviceAccess.get('pureService') === 'pure'
  )
}

export async function testPureServiceLoadBalancingPrevention() {
  const state = createRegistryState()
  const uniqueName = `pureService_lb_${Date.now()}`
  
  // First registration should succeed
  await registerService(state, {
    service: uniqueName,
    location: 'pure://local',
    accessControl: 'pure'
  })
  
  // Second registration should fail (load-balancing not allowed for pure)
  let errorMessage = null
  let errorStatus = null
  try {
    await registerService(state, {
      service: uniqueName,
      location: 'pure://local2',
      accessControl: 'pure'
    })
  } catch (err) {
    errorMessage = err.message
    errorStatus = err.status
  }
  
  await assert(true,
    () => errorMessage !== null,
    () => errorMessage.includes('cannot be load-balanced'),
    () => errorStatus === 409
  )
}

export async function testPureServiceConflictWithNonPure() {
  const state = createRegistryState()
  const uniqueName = `conflictService_pure_${Date.now()}`
  
  // Register a pure service first
  await registerService(state, {
    service: uniqueName,
    location: 'pure://local',
    accessControl: 'pure'
  })
  
  // Try to register a private service with the same name
  let errorMessage = null
  let errorStatus = null
  try {
    await registerService(state, {
      service: uniqueName,
      location: 'http://localhost:3001',
      accessControl: 'private'
    })
  } catch (err) {
    errorMessage = err.message
    errorStatus = err.status
  }
  
  await assert(true,
    () => errorMessage !== null,
    () => errorMessage.includes('pure service with this name already exists'),
    () => errorStatus === 409
  )
}

export async function testNonPureConflictWithPure() {
  const state = createRegistryState()
  const uniqueName = `conflictService_nonpure_${Date.now()}`
  
  // Register a private service first
  await registerService(state, {
    service: uniqueName,
    location: 'http://localhost:3001',
    accessControl: 'private'
  })
  
  // Try to register a pure service with the same name
  let errorMessage = null
  let errorStatus = null
  try {
    await registerService(state, {
      service: uniqueName,
      location: 'pure://local',
      accessControl: 'pure'
    })
  } catch (err) {
    errorMessage = err.message
    errorStatus = err.status
  }
  
  await assert(true,
    () => errorMessage !== null,
    () => errorMessage.includes('already exists with access control'),
    () => errorStatus === 409
  )
}

export async function testPrivateServiceLoadBalancing() {
  const state = createRegistryState()
  const uniqueName = `loadBalancedService_${Date.now()}`
  
  // First registration
  await registerService(state, {
    service: uniqueName,
    location: 'http://localhost:3001',
    accessControl: 'private'
  })
  
  // Second registration should succeed (load-balancing allowed for private)
  await registerService(state, {
    service: uniqueName,
    location: 'http://localhost:3002',
    accessControl: 'private'
  })
  
  await assert(state,
    s => s.services.get(uniqueName).size === 2,
    s => s.services.get(uniqueName).has('http://localhost:3001'),
    s => s.services.get(uniqueName).has('http://localhost:3002')
  )
}

// --- Access Control Validation Tests ---

export async function testAccessControlLevels() {
  // Verify all access control levels are distinct
  const levels = ['pure', 'local', 'private', 'public']
  const descriptions = {
    'pure': 'No HTTP server, direct function call only',
    'local': 'HTTP server but accessible only from same node',
    'private': 'HTTP server, accessible from any service',
    'public': 'HTTP server, accessible via gateway'
  }
  
  await assert(levels,
    l => l.length === 4,
    l => new Set(l).size === 4, // All unique
    l => l.includes('pure'),
    l => l.includes('local'),
    l => l.includes('private'),
    l => l.includes('public')
  )
  
  // Verify each level has a description
  for (const level of levels) {
    await assert(descriptions[level],
      d => typeof d === 'string',
      d => d.length > 0
    )
  }
}

