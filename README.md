# YAMF - Yet Another Microservice Framework

A lightweight microservices framework for Node.js with built-in service discovery, API gateway, pub/sub messaging, and multi-language support. **`@yamf/core`** has **zero npm dependencies** at runtime (pure Node.js built-ins). Optional packages such as **`@yamf/client`** add their own small dependency set (e.g. **morphdom** for DOM patching in the browser).

[![CI](https://github.com/mcbrumagin/yamf/actions/workflows/ci.yml/badge.svg)](https://github.com/mcbrumagin/yamf/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-pnpm%20test-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## 🚀 Quick Start

```bash
npm install @yamf/core
```

```javascript
import { registryServer, createService, callService } from '@yamf/core'

// Start the registry
await registryServer()

// Create a service
await createService('hello', function (payload) {
  return { message: 'Hello, ' + payload.name }
})

// Call the service
const result = await callService('hello', { name: 'World' })
console.log(result.message) // "Hello, World"
```

## ✨ Core Features

- **Zero Dependencies (`@yamf/core` runtime)** - The core server ships with no npm packages—only Node.js built-ins—so the registry, gateway, and RPC stack avoid third-party supply-chain risk. Other packages (e.g. `@yamf/client`) may declare dependencies as needed.
- **Service discovery** - Services **register** with a central registry; each peer keeps a **replicated service cache** so steady-state `callService` is direct HTTP to the right instance (the registry is still source of truth and reconciliation).
- **API Gateway** - Built-in reverse proxy with HTTP routing
- **Pub/Sub messaging** - Event-driven communication; includes cache **invalidation and bulk/coalesced** update paths (see [roadmap](docs/ROADMAP.md))
- **Load Balancing** - Round-robin distribution across service instances
- **Multi-Language Support** - Python client available, seamless interoperability
- **Modular Architecture** - Use only what you need
- **Well-tested** — Strong automated tests for core and client; see [Testing](docs/TESTING.md) and [CI](.github/workflows/ci.yml) on the default branch.

## 📦 Packages

YAMF is organized as a monorepo with independently versioned packages:

### Core Packages

- **[@yamf/core](./packages/core/)** - Microservices framework with registry, gateway, RPC, and pub/sub
- **[@yamf/client](./packages/client/)** - Isomorphic HTML-as-JavaScript library for building UIs (includes [morphdom](https://github.com/patrick-steele-idem/morphdom) for client-side DOM updates)
- **[@yamf/shared](./packages/shared/)** - Shared utilities: validator, XSS helpers, case-mapping. See [Shared README](./packages/shared/README.md).

### Service Modules

- **[@yamf/services-auth](./packages/services/auth/)** - JWT-lite authentication (ed25519, optional sessions, custom password validation)
- **[@yamf/services-cache](./packages/services/cache/)** - In-memory caching with TTL and eviction
- **[@yamf/services-file-server](./packages/services/file-server/)** - Static file serving with flexible routing
- **[@yamf/services-file-upload](./packages/services/file-upload/)** - Multipart file upload handling
- **[@yamf/services-postgres](./packages/services/postgres/)** - Postgres.js wrapper with parameterized templates and camelCase mapping
- **[@yamf/services-user](./packages/services/user/)** - User CRUD, self-signup, admin-invite, registration tokens, verification

### CLI and orchestration (build, deploy, dev)

- **[@yamf/cli](./packages/cli/)** - `yamf build`, `yamf deploy` (local / remote), `yamf dev` (watch + rolling deploy to PM3 + `yamf:dev-reload` pub), `yamf test`, and lifecycle helpers. See the [CLI README](./packages/cli/README.md) and the [framework roadmap](docs/ROADMAP.md) (what is shipped and what is next).

- **[@yamf/services-config](./packages/services/config/)** - Encrypted config overlay for deploy-time secrets (used with the deploy driver).

- **[@yamf/services-dev-hmr](./packages/services/dev-hmr/)** - Dev-only **SSE** service subscribed to `yamf:dev-reload` so browsers can get `reload` events when `yamf dev` redeploys a service or the Vite dev plugin fans out a change.

- **[@yamf/services/deploy-router](./packages/services/deploy-router/)** - In-process `registerCommand` handlers for `deploy-plan` / `deploy-bundle` (signed bundles, placement hooks).

### Development tools

- **[@yamf/test](./packages/test/)** - Custom testing framework with multi-assertion support. See [Testing conventions](./docs/TESTING.md) for YAMF-specific `withEnv` and `.env.test` usage.

## 🎯 Use Cases

- **Microservices Architecture** - Build distributed systems with service discovery
- **API Gateways** - Route HTTP requests to backend services
- **Event-Driven Systems** - Pub/sub messaging for decoupled communication
- **Full-Stack Applications** - Combine @yamf/core with @yamf/client for complete solutions
- **Polyglot Systems** - Mix Node.js and Python services seamlessly

## 🌍 Multi-Language Support

YAMF supports multiple programming languages with consistent APIs:

```javascript
// Node.js service
await createService('node-service', function (payload) {
  return await this.call('pythonService', payload)
})
```

```python
# Python service
from yamf import create_service_sync

def python_service(payload):
    return {"message": f"Hello from Python: {payload.get('name')}"}

create_service_sync("pythonService", python_service)
```

## 🏗️ Architecture

**Spine and muscle memory:** the **registry** is the long-lived **spine** — authoritative state, registration, and pub/sub so the system always **converges** when topology or contracts change. Each service keeps a local **in-process service cache** (replicated from the registry): that’s **muscle memory** for steady work — `callService` can go **direct to the right instance** without a control-plane hop on every request. On a miss, inconsistency, or update, the registry and cache path **re-teach** the muscle (pull, or push via pub/sub). The **gateway** in front is the same idea for **HTTP clients**: a stable edge that **pulls** registry state and routes; see [Core framework](./packages/core/README.md) for details.

```
┌────────────────────────┐  ┌─────────────────────────┐
│ -- Service Registry -- │  │ --- API Gateway ------- │
│  - Service discovery   │  │ - Pulls registry state  │
│  - Pub/Sub Routing     │  │ - API Routing           │
│  - Load Balancing      │  │ - Also Load Balancing   │
└──────────────────┬─────┘  └─────┬───────────────────┘
                   │              |       
        ┌──────────┼──────────────┼───────────┐
        │          │              │           │
    ┌───▼───┐   ┌──▼────┐   ┌─────▼──┐   ┌────▼───┐
    │Service│   │Service│   │Service │   │Service │
    │  A    │   │  B    │   │  C     │   │  D     │
    │(Node) │   │(Node) │   │(Python)│   │(Node)  │
    └───────┘   └───────┘   └────────┘   └────────┘
```

## 📚 Documentation

### Roadmap and deep dives
- [Framework roadmap](docs/ROADMAP.md) - What shipped (orchestrator, deploy, cache coalescing), **active** follow-on work, and deferred horizon items.
- [D4 SPA / dev HMR](docs/D4-SPA-HMR-ANALYSIS.md) - Vite HMR vs `yamf:dev-reload` vs `connectYamfDevHmr` / `createYamfDevHmrSpaPatch` (state-preserving tab on Vite-originated reloads; full reload after `yamf dev` service deploy).
- [Testing](docs/TESTING.md) - Where the tests live; filters for `yamf test -d <pkg> -f <pattern>`.

### Getting started
- [Core Framework](./packages/core/README.md) - API reference and examples
- [Client Library](./packages/client/README.md) - UI development; includes **Vite + YAMF HMR** notes
- [Shared Library](./packages/shared/README.md) - Validator, utilities, and isomorphic helpers
- [Examples](./packages/core/examples/README.md) - Sample applications and patterns

### Multi-Language Clients
- [Python Client](./packages/core/src/api/languages/python/README.md) - Python integration guide
- [Go Client](./packages/core/src/api/languages/go/README.md) - Go client (in development)

### Service Modules
- [Authentication](./packages/services/auth/README.md) - JWT-lite auth service (login, tokens, optional sessions)
- [Caching](./packages/services/cache/README.md) - In-memory cache service
- [File Server](./packages/services/file-server/README.md) - Static file serving
- [File Upload](./packages/services/file-upload/README.md) - Multipart file uploads
- [Postgres](./packages/services/postgres/README.md) - Postgres.js wrapper (parameterized queries, camelCase)
- [User](./packages/services/user/README.md) - User CRUD, registration, verification, tokens

For a full stack using **Postgres + User + Auth** together (self-signup, admin-invite, login), see the [psql-user-auth example](./packages/core/examples/psql-user-auth/).

## 🛠️ In this monorepo

```bash
git clone https://github.com/mcbrumagin/yamf.git
cd yamf
pnpm install
pnpm test
```

The repo uses **pnpm** workspaces. Per-package: `cd packages/core && pnpm test` (or `yamf test -d <dir>` — see [CLI](./packages/cli/README.md)).

## 🧭 Dev and deploy in practice

At a high level, **one mental model** covers local and production:

1. **Registry** — services register; everyone else **pulls** or receives **pub/sub** cache updates to stay in sync.
2. **`yamf build` / `yamf deploy --local` or `--remote`** — content-addressed bundles, `YAMF_SOURCE_HASH` (and config version) on replicas; the deploy driver’s **decision** table chooses scale vs rolling (see [roadmap](docs/ROADMAP.md)).
3. **`yamf dev` (watch + deploy)** — same `planAndApply` path; after a successful (re)deploy it **publishes** `yamf:dev-reload` with `{ source: 'yamf-dev', service, hash, at }` so dev browsers and tooling can react.
4. **Browser (optional)** — the **Vite** plugin `yamfVitePluginDev` (from `@yamf/client`) can also publish to `yamf:dev-reload` with `{ source: 'vite', at }` when the dev server HMR graph changes, so the **yamf-dev** SSE can coordinate **all tabs** the same way as a backend roll. Client apps use `@yamf/client/dev-hmr` (`connectYamfDevHmr`, D4’s `createYamfDevHmrSpaPatch`) to **avoid** a full `location.reload` for Vite-originated events while still **full-reloading** after a service redeploy. Details: [D4-SPA-HMR-ANALYSIS.md](docs/D4-SPA-HMR-ANALYSIS.md).
5. **Cache pressure** — for large registries, set `YAMF_CACHE_COALESCE_MS` (default `0` = legacy; `>0` = coalesced + bulk) — [ROADMAP](docs/ROADMAP.md) (env table and orchestrator *What shipped*).

## 🚢 Deployment

YAMF targets **k8s, bare PM3, or plain Node** with the same primitives (no vendor lock for “rolling”): signed bundles, deploy router, registry drain, gateway readiness. For examples and layout:

- [Deployment / examples](./packages/core/examples/)
- [Framework roadmap](docs/ROADMAP.md) for remote deploy, canary, and follow-ups

## 🌟 Real-World Examples

- **[mcbrumagin.com](https://mcbrumagin.com)** - Portfolio website built with YAMF
  - [Source Code](https://github.com/mcbrumagin/portfolio)
- **[soundcl.one](https://soundcl.one)** - Audio streaming platform (working prototype)
  - [Source Code](https://github.com/mcbrumagin/soundclone)
  - Features: authentication, file uploads, audio streaming, multi-container architecture

## 🤝 Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for features, examples, tests, dependency rules, and release notes expectations.

## 📄 License

MIT — see [LICENSE](LICENSE).

## 🙏 Credits

Built with ❤️ by [Matthew C Brumagin](https://github.com/mcbrumagin)

**`@yamf/core`** uses no external npm packages at runtime (pure Node.js). UI work via **`@yamf/client`** pulls in **morphdom** (and `@yamf/shared`) as documented in the [client README](./packages/client/README.md).
