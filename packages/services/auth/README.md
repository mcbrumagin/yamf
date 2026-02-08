# @yamf/services-auth

JWT-lite authentication service for YAMF: ed25519-signed tokens, optional sessions, and pluggable password validation.

[![Version](https://img.shields.io/badge/version-0.1.2-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## Installation

```bash
npm install @yamf/services-auth @yamf/services-cache
```

## Quick Start (login flow)

Credentials are validated by a **custom `validateUserPassword(username, password)`** function you provide. The auth service uses it on login and returns an access token (and sets a refresh-token cookie when sessions are enabled).

```javascript
import { callService, HEADERS, COMMANDS } from '@yamf/core'
import createAuthService from '@yamf/services-auth'

async function validateUserPassword(username, password) {
  // Check against your DB (e.g. via @yamf/services-postgres + Argon)
  // Return true/false
  return await myCheckUser(username, password)
}

const auth = await createAuthService({
  serviceName: 'auth-service',
  validateUserPassword,
  useSessions: 'refresh-only'  // or true | false
})

// Client logs in by calling auth-service with AUTH_LOGIN command
const authResult = await callService('auth-service', {
  body: { authenticate: { user: 'alice@example.com', password: 'secret' } },
  headers: { [HEADERS.COMMAND]: COMMANDS.AUTH_LOGIN }
})
// authResult.accessToken — send this on protected requests

// Call a protected service
const data = await callService('my-service', {
  body: { ... },
  headers: { [HEADERS.AUTH_TOKEN]: authResult.accessToken }
})
```

For a **full example** (Postgres + User + Auth, self-signup, admin-invite, login), see [psql-user-auth](../../core/examples/psql-user-auth/) in the repo.

## Features

- **Ed25519 signing** – Asymmetric signing for access/refresh tokens (no JWT header needed).
- **Pluggable password validation** – You implement `validateUserPassword(username, password)` (e.g. using @yamf/services-postgres and Argon).
- **Optional sessions** – `useSessions: 'refresh-only'` or `true`; uses @yamf/services-cache for token storage and optional revocation.
- **Configurable expiry** – Access and refresh token lifetimes (defaults in code).
- **Gateway integration** – Use `HEADERS.COMMAND`: `COMMANDS.AUTH_LOGIN` for login; send `HEADERS.AUTH_TOKEN` for protected service calls. Register services with `useAuthService: 'auth-service'` so the gateway enforces the token.

## API

### createAuthService(options)

| Option                 | Default             | Description |
|------------------------|---------------------|-------------|
| `serviceName`          | `'auth-service'`    | YAMF service name. |
| `useSessions`          | `'refresh-only'`    | `true`, `'refresh-only'`, or `false`. |
| `validateUserPassword` | env-based default   | `async (username, password) => boolean`. Required for real deployments. |

### Login (authenticate)

Send a request to the auth service with:

- **Headers**: `[HEADERS.COMMAND]: COMMANDS.AUTH_LOGIN`
- **Body**: `{ authenticate: { user: username, password: password } }`

Response includes `accessToken`. When sessions are enabled, a refresh-token cookie is also set.

### Protected service calls

Send the token on each call to protected services:

- **Headers**: `[HEADERS.AUTH_TOKEN]: accessToken`

When creating a service, pass `useAuthService: 'auth-service'` (and optionally `accessControl: 'public'` for unauthenticated routes) so the gateway validates the token.

### Other payloads (internal)

- `verifyAccess` – Verify an access token.
- `getNewAccessToken` – Exchange refresh token (e.g. from cookie) for a new access token.
- `logout` – (Planned) Invalidate session.

## Dependencies

- `@yamf/core` – createService, HttpError, crypto (ed25519)
- `@yamf/services-cache` – Token/session storage when useSessions is enabled

## License

MIT
