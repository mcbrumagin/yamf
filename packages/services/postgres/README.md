# @yamf/services-postgres

Postgres.js wrapper for YAMF: parameterized SQL templates, camelCase result mapping, and safe placeholder validation.

[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## Installation

```bash
npm install @yamf/services-postgres
```

Peer dependencies: `@yamf/core`, `@yamf/shared`. The package uses [postgres](https://github.com/porsager/postgres) (`postgres` npm package).

## Quick Start

```javascript
import { registryServer, createService, callService } from '@yamf/core'
import createPostgreSqlService from '@yamf/services-postgres'

await registryServer()

const postgres = await createPostgreSqlService({
  serviceName: 'postgres-service',
  psqlConfig: 'postgres://user:pass@localhost/dbname'
  // or: { PGDATABASE: 'yamf', PGUSER: 'yamf', PGPASSWORD: 'changeme' }
})

// Call from another service or gateway
const [row] = await callService('postgres-service', {
  template: `SELECT user_id, username, is_active FROM yamf.user WHERE username = :username`,
  data: { username: 'alice@example.com' }
})
// row has camelCase keys: userId, username, isActive
```

## Features

- **Parameterized queries** – Template placeholders `:name` are replaced with safe parameters; no string interpolation of user input.
- **CamelCase mapping** – Result rows are converted from `snake_case` to camelCase by default (via `@yamf/shared`).
- **Placeholder validation** – Only valid identifiers are allowed for placeholder names to prevent injection.
- **Postgres.js** – Uses [postgres](https://github.com/porsager/postgres) under the hood.

## API

### `createPostgreSqlService(options)`

| Option        | Default             | Description |
|---------------|---------------------|-------------|
| `serviceName` | `'postgres-service'` | YAMF service name to register. |
| `psqlConfig`  | env / `{ PGDATABASE, PGUSER, PGPASSWORD }` | Postgres connection string or config object. |
| `schema`      | `null`              | Optional schema setup. |
| `seed`        | `null`              | Optional seed logic. |

### Payload

Call the service with:

- **`template`** (string) – SQL with `:placeholder` names in camelCase (e.g. `:userId`, `:isActive`).
- **`data`** (object) – Keys match placeholder names (camelCase). All placeholders must have a value.
- **`options`** (optional) – e.g. `{ mapCase: true }` (default). Set `mapCase: false` to skip camelCase conversion.

Returns the result of the query (array of rows, or raw result from postgres.js). With `mapCase: true`, row keys are camelCase.

## Template and data

- Use **camelCase** for placeholder names in the template and for keys in `data`: `:userId`, `:username`, `:isActive`.
- Write **snake_case** in SQL as usual: `user_id`, `username`, `is_active`.
- Only valid identifier names are allowed for placeholders (alphanumeric and underscore, no SQL injection via placeholder names).

Example:

```javascript
await callService('postgres-service', {
  template: `
    SELECT user_id, username, is_registered, is_active
    FROM yamf.user
    WHERE user_id = :userId OR username = :username
  `,
  data: { userId: 1, username: 'alice@example.com' }
})
```

## Using with other services

This service is the data layer for **@yamf/services-user** and for custom auth (e.g. looking up users and verifying passwords). For a full example that wires Postgres + User + Auth together, see the [psql-user-auth example](../../core/examples/psql-user-auth/) in the repo.

## Dependencies

- `postgres` – Postgres.js driver
- `@yamf/core` – createService, callService, HttpError
- `@yamf/shared` – toCamelCase for result mapping

## License

MIT
