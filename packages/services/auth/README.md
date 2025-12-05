# @yamf/services-auth

JWT-lite authentication service for YAMF microservices.

[![Version](https://img.shields.io/badge/version-0.1.2-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## Installation

```bash
npm install @yamf/services-auth @yamf/services-cache
```

## Quick Start

```javascript
import { createAuthService } from '@yamf/services-auth'

const auth = await createAuthService({
  secret: 'your-secret-key',
  tokenExpiry: 3600000 // 1 hour in milliseconds
})

// Generate token
const token = await callService('auth', {
  generate: {
    userId: '123',
    email: 'user@example.com'
  }
})

// Verify token
const payload = await callService('auth', {
  verify: token
})
```

## Features

- **JWT-like Tokens** - Lightweight token generation and verification
- **Session Management** - Token storage and invalidation
- **Cache Integration** - Uses @yamf/services-cache for token storage
- **Configurable Expiry** - Set custom token lifetimes
- **Secure** - HMAC-based signatures

## API

### Generate Token

```javascript
await callService('auth', {
  generate: {
    userId: 'user-123',
    email: 'user@example.com',
    role: 'admin'
  }
})
// Returns: "eyJhbGc...token"
```

### Verify Token

```javascript
await callService('auth', {
  verify: 'eyJhbGc...token'
})
// Returns: { userId: 'user-123', email: 'user@example.com', role: 'admin' }
```

### Invalidate Token

```javascript
await callService('auth', {
  invalidate: 'eyJhbGc...token'
})
// Returns: { success: true }
```

## Dependencies

- `@yamf/core` - Core framework
- `@yamf/services-cache` - Token storage

## License

MIT
