# @yamf/core Python Client

Python client library for the @yamf/core microservices framework with **full API parity** with the Node.js implementation.

[![Python](https://img.shields.io/badge/python-%3E%3D3.8-blue)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## Features

✅ **Full API Parity** - Same capabilities as the Node.js client  
✅ **Service Creation** - Create and register microservices  
✅ **Service-to-Service Calls** - Call other services from within handlers  
✅ **HTTP Routes** - Map URL paths to services  
✅ **Pub/Sub Messaging** - Publish and subscribe to channels  
✅ **Standalone Subscriptions** - Subscribe without a full service  
✅ **Async/Sync APIs** - Both async and synchronous interfaces  
✅ **Error Handling** - Proper HTTP error propagation  

## Installation

```bash
pip install -r requirements.txt
```

Or install directly:

```bash
pip install aiohttp
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `YAMF_REGISTRY_URL` | Registry server URL (e.g., `http://localhost:3000`) | Yes |
| `YAMF_REGISTRY_TOKEN` | Authentication token for protected registries | No |

## Quick Start

```python
from yamf import create_service_sync, call_service_sync
import os

os.environ['YAMF_REGISTRY_URL'] = 'http://localhost:3000'

# Create a service
def my_service(payload):
    return {"message": f"Hello {payload.get('name', 'World')}!"}

service = create_service_sync("my_service", my_service)

# Call a service
result = call_service_sync("my_service", {"name": "Alice"})
print(result)  # {"message": "Hello Alice!"}
```

## API Reference

### Creating Services

#### `create_service(name_or_fn, service_fn=None, options=None)` (async)
#### `create_service_sync(name_or_fn, service_fn=None, options=None)` (sync)

Creates and registers a microservice with the registry.

```python
from yamf import create_service_sync

# Named service with function
def handler(payload):
    return {"result": payload.get("value", 0) * 2}

service = create_service_sync("doubler", handler)

# Service with options
service = create_service_sync("protected_service", handler, {
    "useAuthService": "auth-service"
})

# Keep service running
try:
    import time
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    service.terminate()
```

**Parameters:**
- `name_or_fn` (str | Callable): Service name or handler function
- `service_fn` (Callable, optional): Handler function if name is provided separately
- `options` (dict, optional): Configuration options
  - `useAuthService`: Name of auth service for protected routes

**Returns:** `YamfService` instance with `terminate()` method

### Calling Services

#### `call_service(name, payload=None, content_type='application/json', auth_token=None)` (async)
#### `call_service_sync(name, payload=None, content_type='application/json', auth_token=None)` (sync)

Calls a service by name through the registry.

```python
from yamf import call_service_sync

# Simple call
result = call_service_sync("my_service", {"data": "test"})

# With authentication
result = call_service_sync(
    "protected_service",
    {"data": "test"},
    auth_token="your-jwt-token"
)
```

**Parameters:**
- `name` (str): Service name to call
- `payload` (any): Request data (JSON serialized)
- `content_type` (str): Content-Type header (default: 'application/json')
- `auth_token` (str, optional): Authentication token

**Returns:** Deserialized response (JSON or text)

### HTTP Routes

#### `create_route(path, service_name_or_fn, data_type='application/json')` (async)
#### `create_route_sync(path, service_name_or_fn, data_type='application/json')` (sync)

Maps a URL path to a service.

```python
from yamf import create_route_sync

# Route with inline handler
def users_handler(payload):
    return {"users": ["Alice", "Bob", "Charlie"]}

service = create_route_sync("/api/users", users_handler)

# Route pointing to existing service
create_route_sync("/api/orders", "order_service")

# Wildcard routes
def users_controller(payload):
    url = payload.get("url", "")
    # Handle /api/users/123, /api/users/profile, etc.
    return {"path": url}

create_route_sync("/api/users/*", users_controller)
```

**Parameters:**
- `path` (str): URL path (e.g., '/api/users', '/api/*')
- `service_name_or_fn` (str | Callable): Service name or handler function
- `data_type` (str): Content type (default: 'application/json')

**Returns:** `YamfService` instance if function provided, None otherwise

### Pub/Sub Messaging

#### `publish_message(channel, message)` (async)
#### `publish_message_sync(channel, message)` (sync)

Publishes a message to all subscribers of a channel.

```python
from yamf import publish_message_sync

result = publish_message_sync("user-events", {
    "type": "user.created",
    "userId": 123,
    "email": "user@example.com"
})

print(result)  # {"results": [...], "errors": [...]}
```

**Parameters:**
- `channel` (str): Channel name
- `message` (any): Message payload (JSON serialized)

**Returns:** Dict with 'results' and 'errors' arrays

#### `create_subscription_service(channels, handler, options=None)` (async)
#### `create_subscription_service_sync(channels, handler, options=None)` (sync)

Creates a service that subscribes to one or more channels.

```python
from yamf import create_subscription_service_sync

def handle_user_event(message):
    print(f"User event: {message}")
    return {"status": "processed"}

# Single channel
subscription = create_subscription_service_sync(
    "user-events",
    handle_user_event
)

# Multiple channels with dict
subscription = create_subscription_service_sync({
    "user-events": handle_user_event,
    "order-events": handle_order_event
})

# Cleanup
subscription.terminate()
```

### Service Context (Self-Calls)

Services can call other services and publish messages using `self`:

```python
from yamf import create_service_sync

# Handler receives 'self' for context operations
async def orchestrator_service(self, payload):
    # Call another service
    user = await self.call("user_service", {"id": payload["userId"]})
    
    # Publish an event
    await self.publish("user-accessed", {"userId": user["id"]})
    
    return {"user": user, "accessed": True}

service = create_service_sync("orchestrator", orchestrator_service)
```

**Context Methods:**
- `self.call(service_name, payload)` - Call another service
- `self.publish(channel, message)` - Publish to a channel

## Async API

All functions have async versions without the `_sync` suffix:

```python
from yamf import create_service, call_service, publish_message
import asyncio

async def main():
    # Create service
    service = await create_service("async_service", lambda p: {"ok": True})
    
    # Call service
    result = await call_service("async_service", {})
    
    # Publish message
    await publish_message("events", {"type": "test"})
    
    # Cleanup
    service.terminate()

asyncio.run(main())
```

## Error Handling

### YamfError

Base error class for all YAMF errors.

```python
from yamf import YamfError, call_service_sync

try:
    result = call_service_sync("nonexistent_service", {})
except YamfError as e:
    print(f"YAMF Error: {e.message}")
    print(f"Status Code: {e.status_code}")
```

### HttpError

HTTP-specific errors with status codes.

```python
from yamf import HttpError

def my_service(payload):
    if not payload.get("userId"):
        raise HttpError(400, "Missing required field: userId")
    return {"status": "ok"}
```

### Error Types

| Error | Description |
|-------|-------------|
| `YamfError` | Base error class |
| `HttpError` | HTTP errors with status codes |
| `ConfigError` | Configuration errors |
| `ServiceNotFoundError` | Service lookup failures |
| `RegistrationError` | Service registration failures |

## Advanced Usage

### Custom Headers

Access YAMF protocol headers for advanced use cases:

```python
from yamf import (
    build_call_headers,
    build_publish_headers,
    build_subscribe_headers,
    Header,
    Command
)

# Build custom headers
headers = build_call_headers("my_service")
headers[Header.AUTH_TOKEN] = "custom-token"
```

### Protocol Constants

```python
from yamf import Header, Command

# Available headers
Header.COMMAND          # 'yamf-command'
Header.SERVICE_NAME     # 'yamf-service-name'
Header.PUBSUB_CHANNEL   # 'yamf-pubsub-channel'
Header.AUTH_TOKEN       # 'yamf-auth-token'
# ... and more

# Available commands
Command.SERVICE_CALL    # 'service-call'
Command.PUBSUB_PUBLISH  # 'pubsub-publish'
Command.PUBSUB_SUBSCRIBE # 'pubsub-subscribe'
# ... and more
```

## Comparison with Node.js API

| Feature | Node.js | Python |
|---------|---------|--------|
| Create Service | `createService(fn)` | `create_service(fn)` / `create_service_sync(fn)` |
| Call Service | `callService(name, payload)` | `call_service(name, payload)` / `call_service_sync(name, payload)` |
| Create Route | `createRoute(path, fn)` | `create_route(path, fn)` / `create_route_sync(path, fn)` |
| Publish Message | `publishMessage(ch, msg)` | `publish_message(ch, msg)` / `publish_message_sync(ch, msg)` |
| Subscription Service | `createSubscriptionService(ch, fn)` | `create_subscription_service(ch, fn)` / `create_subscription_service_sync(ch, fn)` |
| Service Context | `this.call()`, `this.publish()` | `self.call()`, `self.publish()` |

## Examples

See the [examples/python-services](../../examples/python-services/) directory for complete examples:

- `simple-service.py` - Basic service example
- `service-with-calls.py` - Service-to-service calls
- `route-example.py` - HTTP route mapping
- `pubsub-publisher.py` - Publishing messages
- `pubsub-subscriber.py` - Subscribing to channels
- `standalone-subscription.py` - Standalone subscriptions
- `test-client.py` - Comprehensive test client
- `mixed-example.js` - Mixed Node.js/Python services

## Troubleshooting

### Service registration fails
- Ensure registry is running on the correct port
- Check `YAMF_REGISTRY_URL` environment variable
- Verify network connectivity

### Service calls fail
- Ensure target service is registered and running
- Check service names match exactly (case-sensitive)
- Review registry logs for errors

### Pub/sub messages not received
- Ensure subscription is registered before publishing
- Check channel names match exactly
- Verify both services are connected to the same registry

### Import errors
- Ensure you're running from the correct directory
- Check that `aiohttp` is installed
- Verify Python version >= 3.8

## License

MIT
