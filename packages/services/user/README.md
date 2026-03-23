# @yamf/services-user

User management service for YAMF: CRUD, self-signup, admin-invite with registration tokens, and optional verification workflows.

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
})

// Self-signup: create with password
const { create } = await callService('user-service', {
  create: { username: 'user@example.com', password: 'secret123' }
})

// Get user
const { get } = await callService('user-service', {
  get: { username: 'user@example.com' }
})
```

For a **complete runnable example** that combines Postgres, User, and Auth (self-signup, admin-invite, login), see [packages/core/examples/psql-user-auth](../../core/examples/psql-user-auth/) in the repo.

---

## Use Case Outlines

### 1. General use-case (Signup → Verify → Login)

| Step | Action | User Service Call |
|------|--------|-------------------|
| Signup | User submits email + password | `create: { username, password }` |
| Verify | Optional: user clicks email/SMS link | `verify: { userId }` or `verify: { username }` + `update: { userId, isActive: true }` |
| Login | User logs in | `checkPassword: { username, password }` (or Auth service using same credential check) |

**Custom implementation**: Email/SMS verification links require a token service. The user-service `verify` action accepts `userId` or `username`; token-based verification (e.g. link contains a short-lived token) must be implemented outside the user service (generate token, store mapping, redeem token → call `verify`).

---

### 2. Self-hosted app (Admin creates → User registers with token → Login)

| Step | Action | User Service Call |
|------|--------|-------------------|
| Admin creates | Admin sends invite (pending row + token) | `invite: { username?, ... }` → returns `token` |
| Send invite | Send token to user (email, etc.) | *Custom: your app sends the token* |
| User registers | User submits token + password | `register: { token, password }` |
| Login | User logs in | `checkPassword` / Auth service |

**Optional**: If user loses token, admin can resend: `createToken: { userId, expiresIn? }`.

---

### 3. Cloud app – General user (Signup + robot test → Verify → Login)

| Step | Action | User Service Call |
|------|--------|-------------------|
| Signup | User passes robot test (CAPTCHA, etc.) on same page | Robot test is handled by a **separate service**. Then `create: { username, password }` |
| Verify | Optional email/SMS | Same as Use Case 1 |
| Login | User logs in | `checkPassword` / Auth service |

**Custom implementation**: The robot test (CAPTCHA, etc.) is outside the user service. Your gateway or signup API should call the robot test service first, then call user-service `create` if it passes.

---

### 4. Cloud app – Privileged user (Signup → limited login → Admin activates → full access)

| Step | Action | User Service Call |
|------|--------|-------------------|
| Signup | User signs up with robot test | `create: { username, password }` (robot test handled elsewhere) |
| Limited login | User can auth but app restricts actions until verified | Auth checks `is_verified`. Your app logic gates actions by `is_verified`. |
| Admin reviews | Admin inspects signup, activates user | `verify: { userId }` + `update: { userId, isActive: true }` |
| Full access | Privileged user logs in and has access | Same `checkPassword`; your app allows access when `is_verified` and `is_active`. |

**Design**: Self-signup creates `is_registered=true`, `is_verified=false`, `is_active=false`. Your auth/authorization layer must enforce `is_verified` and `is_active` before granting full access.

---

## Features

- **Self-signup** – User signs up with password → `is_registered=true`, `is_verified=false`, `is_active=false`.
- **Admin-invite** – `invite` creates a pending row (optional username) → registration token returned once; user completes with `register: { token, password }` → `is_registered=true`, `is_verified=true`.
- **Verification** – `verify` action marks user verified (`is_verified=true`). Token-based verification links require custom implementation.
- **Registration tokens** – Secure, hashed tokens for invite flows; `createToken` reissues a token for existing unregistered users.
- **Lifecycle tracking** – `created_on`, `registered_on`, `verified_on`.
- **CRUD** – `get`, `update`, `remove` for flexibility.
- **Future-ready** – Fields reserved for social login and MFA.

---

## API

### `createUserService(options)`

| Option | Default | Description |
|--------|---------|-------------|
| `serviceName` | `'user-service'` | YAMF service name. |
| `dataService` | `'postgres-service'` | Service name for DB calls (Postgres service). |
| `registrationToken.defaultExpiry` | `48 * 60 * 60 * 1000` (48h) | Token expiry in ms. |
| `registrationToken.length` | `32` | Token byte length. |

### Actions (payload keys)

Call the service with one or more action keys (plus required sub-fields):

| Action | Payload shape | Description |
|--------|---------------|-------------|
| **create** | `create: { username, password, role?, permissions?, isActive?, … }` | Self-signup only (both required). |
| **invite** | `invite: { username?, role?, permissions?, isActive?, profile fields? }` | Pending registration row; returns `token` (show once). No `password`. |
| **register** | `register: { token, password, username?, … }` | Complete registration for an invited user using token. |
| **verifyAndRegister** | `verifyAndRegister: { token, password }` | Same as register: verify token, set password, set both `is_verified` and `is_registered` true. Use for verify-then-register flows (e.g. email link). |
| **verify** | `verify: { userId }` or `verify: { username }` | Mark user verified (e.g. after email/SMS verification). |
| **createToken** | `createToken: { userId, expiresIn? }` | Issue a new registration token (e.g. resend invite). |
| **checkPassword** | `checkPassword: { username, password }` | Verify password; returns `true`/`false`. |
| **get** | `get: { userId? }` or `get: { username? }` | Fetch user by id or username (non-sensitive fields only). |
| **update** | `update: { userId, username?, role?, permissions?, isActive? }` | Update profile/status. |
| **remove** | `remove: { userId? }` or `remove: { username? }` | Delete user. |

---

## Integration with Auth

The [psql-user-auth example](../../core/examples/psql-user-auth/) shows how to:

1. Run registry, gateway, postgres, user, and auth services.
2. Implement `validateUserPassword(username, password)` that loads user from postgres, checks `salt`/`hash` with `checkArgonPassword`, and enforces `is_active`, `is_registered`, `is_verified`.
3. Pass `validateUserPassword` into `createAuthService({ validateUserPassword })`.
4. Protect other services with `useAuthService: 'auth-service'` and send the auth token in headers.

---

## Dependencies

- `@yamf/core` – createService, callService, HttpError, crypto (Argon)
- `@yamf/services-postgres` – data layer
- `@yamf/shared` – validator (for username and action validation)

## License

MIT
