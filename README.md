# YAMF - Yet Another Microservice Framework

A lightweight, zero-dependency microservices framework for Node.js with built-in service discovery, API gateway, pub/sub messaging, and multi-language support.

[![Tests](https://img.shields.io/badge/tests-436%2F436%20passing-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)]()
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
await createService(function helloService(payload) {
  return { message: 'Hello, ' + payload.name }
})

// Call the service
const result = await callService('helloService', { name: 'World' })
console.log(result.message) // "Hello, World"
```

## ✨ Core Features

- **Zero Dependencies** - Pure Node.js implementation, virtually immune to supply-chain attacks
- **Service Discovery** - Automatic registration and dynamic service lookup
- **API Gateway** - Built-in reverse proxy with HTTP routing
- **Pub/Sub Messaging** - Event-driven communication between services
- **Load Balancing** - Round-robin distribution across service instances
- **Multi-Language Support** - Python client available, seamless interoperability
- **Modular Architecture** - Use only what you need
- **Production Ready** - Comprehensive test coverage (90%+) and battle-tested

## 📦 Packages

YAMF is organized as a monorepo with independently versioned packages:

### Core Packages

- **[@yamf/core](./packages/core/)** - Microservices framework with registry, gateway, RPC, and pub/sub
- **[@yamf/client](./packages/client/)** - Isomorphic HTML-as-JavaScript library for building UIs

### Service Modules

- **[@yamf/services-auth](./packages/services/auth/)** - JWT-lite authentication service
- **[@yamf/services-cache](./packages/services/cache/)** - In-memory caching with TTL and eviction
- **[@yamf/services-file-server](./packages/services/file-server/)** - Static file serving with flexible routing
- **[@yamf/services-file-upload](./packages/services/file-upload/)** - Multipart file upload handling

### Development Tools

- **[@yamf/test](./packages/test/)** - Custom testing framework with multi-assertion support
- **[@yamf/shared](./packages/shared/)** - Shared utilities and types

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
await createService(function nodeService(payload) {
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

```
┌────────────────────────┐  ┌─────────────────────────┐
│ -- Service Registry -- │  │ --- API Gateway ------- │
│  - Service Discovery   │  │ - Pulls Regsitry State  │
│  - Pub/Sub Routing     │  │ - API Routing           │
│  - Load Balancing      │  │ - Also Load Balancing   │
└───────────────┬────────┘  └─┬───────────────────────┘
                │             |       
        ┌───────┼─────────────┼─────────┐
        │       │             │         │
    ┌───▼───┐ ┌─▼─────┐ ┌─────▼──┐ ┌────▼───┐
    │Service│ │Service│ │Service │ │Service │
    │  A    │ │  B    │ │  C     │ │  D     │
    │(Node) │ │(Node) │ │(Python)│ │(Node)  │
    └───────┘ └───────┘ └────────┘ └────────┘
```

## 📚 Documentation

### Getting Started
- [Core Framework](./packages/core/README.MD) - Complete API reference and examples
- [Client Library](./packages/client/README.md) - UI development guide
- [Examples](./packages/core/examples/README.md) - Sample applications and patterns

### Multi-Language Clients
- [Python Client](./packages/core/src/api/languages/python/README.md) - Python integration guide
- [Go Client](./packages/core/src/api/languages/go/README.md) - Go client (in development)

### Service Modules
- [Authentication](./packages/services/auth/README.md) - JWT-lite auth service
- [Caching](./packages/services/cache/README.md) - In-memory cache service
- [File Server](./packages/services/file-server/README.md) - Static file serving
- [File Upload](./packages/services/file-upload/README.md) - Multipart file uploads

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/mcbrumagin/yamf.git
cd yamf

# Install dependencies
npm install

# Run tests
npm test

# Run specific package tests
cd packages/core && npm test
```

## 🚢 Deployment

YAMF is designed for cloud-native deployments:

- **Docker** - Multi-container examples included
- **Kubernetes** - K8s manifests and examples provided
- **AWS ECS/Fargate** - Production-ready configuration samples
- **Standalone** - Run as regular Node.js processes

See [deployment examples](./packages/core/examples/) for detailed guides.

## 🌟 Real-World Examples

- **[mcbrumagin.com](https://mcbrumagin.com)** - Portfolio website built with YAMF
  - [Source Code](https://github.com/mcbrumagin/portfolio)
- **[soundcl.one](https://soundcl.one)** - Audio streaming platform (working prototype)
  - [Source Code](https://github.com/mcbrumagin/soundclone)
  - Features: authentication, file uploads, audio streaming, multi-container architecture

## 🤝 Contributing

Contributions are welcome! This project is designed to be:
- Simple and maintainable
- Zero external dependencies (core)
- Well-tested and documented
- Production-ready

## 📄 License

MIT - see [LICENSE](LICENSE) file for details.

## 🙏 Credits

Built with ❤️ by [Matthew C Brumagin](https://github.com/mcbrumagin)

Zero external dependencies - pure Node.js implementation.
