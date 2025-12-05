# @yamf/services-cache

In-memory caching service for YAMF microservices with automatic eviction and TTL support.

[![Version](https://img.shields.io/badge/version-0.1.2-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## Installation

```bash
npm install @yamf/services-cache
```

## Quick Start

```javascript
import { createCacheService } from '@yamf/services-cache'
import { callService } from '@yamf/core'

const cache = await createCacheService({
  expireTime: 60000,      // Default TTL: 60 seconds
  evictionInterval: 30000  // Check every 30 seconds
})

// Set a value
await callService('cache', {
  set: { userId123: { name: 'Alice', email: 'alice@example.com' } }
})

// Get a value
const user = await callService('cache', { get: 'userId123' })

// Delete a value
await callService('cache', { del: { userId123: true } })

// Clear all values
await callService('cache', { clear: true })
```

## Features

- **In-Memory Storage** - Fast read/write performance
- **TTL Support** - Automatic expiration of cached items
- **Automatic Eviction** - Background cleanup of expired items
- **Simple API** - Get, set, delete, and clear operations
- **Zero Dependencies** - Pure JavaScript implementation

## API

### Set Value

```javascript
// Set with default TTL
await callService('cache', {
  set: { myKey: { data: 'value' } }
})

// Set with custom TTL (milliseconds)
await callService('cache', {
  set: { myKey: { data: 'value' } },
  ttl: 120000 // 2 minutes
})
```

### Get Value

```javascript
const value = await callService('cache', { get: 'myKey' })
// Returns: { data: 'value' } or null if not found/expired
```

### Delete Value

```javascript
await callService('cache', { del: { myKey: true } })
// Returns: { success: true }
```

### Clear All

```javascript
await callService('cache', { clear: true })
// Returns: { success: true }
```

## Configuration

```javascript
await createCacheService({
  expireTime: 600000,     // Default TTL: 10 minutes
  evictionInterval: 60000 // Check for expired items every minute
})
```

## Use Cases

- Session storage
- API response caching
- Temporary data storage
- Rate limiting state
- Token storage (for auth service)

## Performance

- **Read**: O(1) constant time lookup
- **Write**: O(1) constant time insertion
- **Eviction**: O(n) where n is number of items (runs in background)

## License

MIT
