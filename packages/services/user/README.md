# @yamf/services-user

User management service for YAMF: CRUD, self-signup, admin-invite with registration tokens, and email/identity verification.

[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## Installation

```bash
npm install @yamf/services-user @yamf/services-postgres @yamf/core
```

The user service stores data via **@yamf/services-postgres** (it calls the postgres service by default). You must run a Postgres service and ensure the `yamf.user` table exists (the service creates it if not present).

## Quick Start

```javascript
import { registryServer, callService } from '@yamf/core'
import createPostgreSqlService from '@yamf/services-postgres'
import createUserService from '@yamf/services-user'

await registryServer()
await createPostgreSqlService({ psqlConfig: 'postgres://yamf:changeme@localhost/yamf' })
await createUserService({
  dataService: 'postgres-service',  // default
  hooks: {
    onTokenGenerated: async (userId, token) => { /* send email */ },
    onRegistered: async (user) => { /* ... */ },
    onVerified: async (user) => { /* ... */ },
  },
})

// Create user (self-signup with password)
const created = await callService('user-service', {
  create: { username: 'user@example.com', password: 'secret123' }
})

// Get user
const { get: user } = await callService('user-service', {
  get: { username: 'user@example.com' }
})
```

For a **complete runnable example** that combines Postgres, User, and Auth (self-signup, admin-invite, login), see the [psql-user-auth example](../../core/examples/psql-user-auth/) in the repo.

## Features

- **Flexible username validation** – Email, pattern (regex), or custom validator.
- **Self-signup** – User signs up with password; `is_registered=true`, `is_verified=false` until verification.
- **Admin-invite** – Admin creates user without password; registration token is generated and sent; user completes registration with token + password.
- **Token-based registration** – Secure tokens for invite/verification flows; optional lifecycle hooks (e.g. send email).
- **Lifecycle tracking** – `created_on`, `registered_on`, `verified_on`, and optional hooks for integration.
- **Future-ready** – Fields reserved for social login and MFA.

## API

### `createUserService(options)`

| Option                 | Default              | Description |
|------------------------|----------------------|-------------|
| `serviceName`          | `'user-service'`     | YAMF service name. |
| `dataService`          | `'postgres-service'` | Service name for DB calls (Postgres service). |
| `usernameValidation`   | `{ type: 'email' }`  | `'email'`, `'pattern'`, `'custom'`, or `'any'`. For `pattern`, set `pattern` (RegExp) and optional `message`. For `custom`, set `validate` (function) and optional `message`. |
| `registrationToken`    | `{ defaultExpiry, length }` | Token expiry (ms) and byte length. |
| `hooks`                | `{}`                 | `onTokenGenerated(userId, token)`, `onRegistered(user)`, `onVerified(user)`. |

### Actions (payload keys)

Call the service with exactly one of these action keys (plus any required sub-fields):

| Action           | Payload shape | Description |
|------------------|---------------|-------------|
| **create**       | `create: { username, password?, isActive? }` | With `password`: self-signup. Without: admin-invite; returns `registrationToken` (show once). |
| **register**      | `register: { token, password }` | Complete registration for an invited user using token. |
| **verify**        | `verify: { userId }` or `verify: { token }` | Mark user verified (e.g. after email verification). |
| **generateToken** | `generateToken: { userId, expiresIn? }` | Issue a new registration token (e.g. resend invite). |
| **get**           | `get: { userId? }` or `get: { username? }` | Fetch user by id or username (non-sensitive fields only). |
| **update**        | `update: { userId, username?, isActive? }` | Update profile/status. |
| **remove**        | `remove: { userId? }` or `remove: { username? }` | Delete user. |

## Self-signup vs admin-invite

- **Self-signup**: `create: { username, password }` → user is created with `is_registered=true`, `is_verified=false`, `is_active=false`. Your app should send a verification link; when the user verifies, call `verify: { userId }` (or `token`), then typically `update: { userId, isActive: true }`.
- **Admin-invite**: `create: { username, isActive? }` (no password) → service creates user and returns a `registrationToken`. Send token to user (email, etc.); user calls `register: { token, password }` to set password and complete registration. User ends up `is_registered=true`, `is_verified=true`.

## Integration with Auth

The [psql-user-auth example](../../core/examples/psql-user-auth/) shows how to:

1. Run registry, gateway, **postgres**, **user**, and **auth** services.
2. Implement `validateUserPassword(username, password)` by calling the postgres service to load `salt`/`hash` and using `checkArgonPassword` from `@yamf/core/crypto`, and to enforce `is_active`, `is_registered`, `is_verified`.
3. Pass `validateUserPassword` into `createAuthService({ validateUserPassword })`.
4. Protect other services with `useAuthService: 'auth-service'` and send the auth token in headers.

## Dependencies

- `@yamf/core` – createService, callService, HttpError, crypto (Argon)
- `@yamf/services-postgres` – data layer
- `@yamf/shared` – validator (for username and action validation)

## License

MIT
