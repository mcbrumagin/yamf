import {
  assert,
  assertEach
} from '@yamf/test'

/**
 * Route Registry Tests
 * Tests for gateway route registry functions
 */

export async function testFindControllerRoute_ExactPrefixMatch() {
  const { findControllerRoute } = await import('../../src/gateway/route-registry.js')
  
  const state = {
    controllerRoutes: new Map([
      ['/api/', { service: 'apiController', dataType: 'application/json' }],
      ['/admin/', { service: 'adminController', dataType: 'text/html' }]
    ])
  }
  
  const result = findControllerRoute(state, '/api/users')
  
  await assert(result,
    r => r !== null,
    r => r.service === 'apiController',
    r => r.dataType === 'application/json'
  )
}

export async function testFindControllerRoute_MultipleMatches_ReturnsFirst() {
  const { findControllerRoute } = await import('../../src/gateway/route-registry.js')
  
  const state = {
    controllerRoutes: new Map([
      ['/api/', { service: 'apiController', dataType: 'application/json' }],
      ['/api/v2/', { service: 'apiV2Controller', dataType: 'application/json' }]
    ])
  }
  
  // Should match the first one (insertion order)
  const result = findControllerRoute(state, '/api/users')
  
  await assert(result,
    r => r !== null,
    r => r.service === 'apiController'
  )
}

export async function testFindControllerRoute_CaseInsensitive() {
  const { findControllerRoute } = await import('../../src/gateway/route-registry.js')
  
  const state = {
    controllerRoutes: new Map([
      ['/api/', { service: 'apiController', dataType: 'application/json' }]
    ])
  }
  
  // Test case insensitivity
  const result1 = findControllerRoute(state, '/API/users')
  const result2 = findControllerRoute(state, '/Api/users')
  const result3 = findControllerRoute(state, '/api/users')
  
  assertEach(
    [result1, result2, result3],
    r => r !== null,
    r => r.service === 'apiController'
  )
}

export async function testFindControllerRoute_NoMatch() {
  const { findControllerRoute } = await import('../../src/gateway/route-registry.js')
  
  const state = {
    controllerRoutes: new Map([
      ['/api/', { service: 'apiController', dataType: 'application/json' }]
    ])
  }
  
  const result = findControllerRoute(state, '/users')
  
  await assert(result, r => r === null)
}

export async function testFindControllerRoute_EmptyRegistry() {
  const { findControllerRoute } = await import('../../src/gateway/route-registry.js')
  
  const state = {
    controllerRoutes: new Map()
  }
  
  const result = findControllerRoute(state, '/api/users')
  
  await assert(result, r => r === null)
}

export async function testFindControllerRoute_NestedPaths() {
  const { findControllerRoute } = await import('../../src/gateway/route-registry.js')
  
  const state = {
    controllerRoutes: new Map([
      ['/api/v1/', { service: 'apiV1Controller', dataType: 'application/json' }],
      ['/api/v2/', { service: 'apiV2Controller', dataType: 'application/json' }]
    ])
  }
  
  const result1 = findControllerRoute(state, '/api/v1/users')
  const result2 = findControllerRoute(state, '/api/v2/posts')
  
  await assert(result1,
    r => r !== null,
    r => r.service === 'apiV1Controller'
  )
  
  await assert(result2,
    r => r !== null,
    r => r.service === 'apiV2Controller'
  )
}

export async function testFindControllerRoute_RootPath() {
  const { findControllerRoute } = await import('../../src/gateway/route-registry.js')
  
  const state = {
    controllerRoutes: new Map([
      ['/', { service: 'rootController', dataType: 'text/html' }]
    ])
  }
  
  const result1 = findControllerRoute(state, '/')
  const result2 = findControllerRoute(state, '/anything')
  
  assertEach(
    [result1, result2],
    r => r !== null,
    r => r.service === 'rootController'
  )
}

export async function testFindControllerRoute_LongerPathsFirst() {
  const { findControllerRoute } = await import('../../src/gateway/route-registry.js')
  
  // More specific paths should be registered first for proper matching
  const state = {
    controllerRoutes: new Map([
      ['/api/admin/', { service: 'adminController', dataType: 'application/json' }],
      ['/api/', { service: 'apiController', dataType: 'application/json' }]
    ])
  }
  
  // Should match the more specific path first
  const result = findControllerRoute(state, '/api/admin/users')
  
  await assert(result,
    r => r !== null,
    r => r.service === 'adminController'
  )
}

// Test registry implementation (has additional functions)
export async function testRegistryRouteRegistry_FindControllerRoute() {
  const { findControllerRoute } = await import('../../src/registry/route-registry.js')
  
  const state = {
    controllerRoutes: new Map([
      ['/api/', { service: 'apiController', dataType: 'application/json' }]
    ])
  }
  
  const result = findControllerRoute(state, '/api/users')
  
  await assert(result,
    r => r !== null,
    r => r.service === 'apiController'
  )
}

export async function testRegistryRouteRegistry_RegisterDirectRoute() {
  const { registerDirectRoute } = await import('../../src/registry/route-registry.js')
  
  const state = {
    routes: new Map()
  }
  
  registerDirectRoute(state, {
    service: 'testService',
    path: '/test',
    dataType: 'application/json'
  })
  
  await assert(state.routes.get('/test'),
    r => r !== undefined,
    r => r.service === 'testService',
    r => r.dataType === 'application/json'
  )
}

export async function testRegistryRouteRegistry_RegisterControllerRoute() {
  const { registerControllerRoute } = await import('../../src/registry/route-registry.js')
  
  const state = {
    controllerRoutes: new Map()
  }
  
  registerControllerRoute(state, {
    service: 'apiController',
    path: '/api/*',
    dataType: 'application/json'
  })
  
  await assert(state.controllerRoutes.get('/api/'),
    r => r !== undefined,
    r => r.service === 'apiController',
    r => r.dataType === 'application/json'
  )
}

export async function testRegistryRouteRegistry_RegisterRoute_AutoDetect() {
  const { registerRoute } = await import('../../src/registry/route-registry.js')
  
  const state = {
    routes: new Map(),
    controllerRoutes: new Map()
  }
  
  // Should auto-detect as direct route
  registerRoute(state, {
    service: 'directService',
    path: '/direct',
    dataType: 'text/plain'
  })
  
  // Should auto-detect as controller route
  registerRoute(state, {
    service: 'controllerService',
    path: '/api/*',
    dataType: 'application/json'
  })
  
  await assert(state.routes.get('/direct'),
    r => r !== undefined,
    r => r.service === 'directService'
  )
  
  await assert(state.controllerRoutes.get('/api/'),
    r => r !== undefined,
    r => r.service === 'controllerService'
  )
}

