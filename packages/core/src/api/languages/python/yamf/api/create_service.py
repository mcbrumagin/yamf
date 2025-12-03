"""
YAMF Create Service

Create and register RPC services with the registry.
"""

from __future__ import annotations
import asyncio
import re
import secrets
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable, Optional

from ..config import env_config
from ..errors import YamfError, RegistrationError
from ..headers import build_setup_headers, build_register_headers, build_unregister_headers
from ..http.client import http_request
from ..http.server import create_http_server, HttpServer
from ..service.state import ServiceState
from ..service.context import ServiceContext, bind_handler
from ..service.handler import create_cache_aware_handler

logger = logging.getLogger('yamf.api')

Handler = Callable[[Any], Awaitable[Any]]


@dataclass
class YamfService:
    """
    A registered yamf RPC service.
    
    Provides:
    - Service metadata (name, location, port)
    - Access to service context and cache
    - Lifecycle management (terminate)
    - Context manager support for automatic cleanup
    
    Example:
        service = await create_service('my_service', my_handler)
        try:
            # Service is running
            await asyncio.sleep(3600)
        finally:
            await service.terminate()
        
        # Or with context manager:
        async with await create_service('my_service', my_handler) as service:
            # Service is running
            await asyncio.sleep(3600)
        # Automatically cleaned up
    """
    
    name: str
    location: str
    port: int
    
    _context: ServiceContext
    _state: ServiceState
    _server: HttpServer
    _handler: Handler
    _before_handler: Optional[Handler] = None
    
    @property
    def context(self) -> ServiceContext:
        """Service execution context with call() and publish()."""
        return self._context
    
    @property
    def cache(self) -> ServiceState:
        """Local cache of registry state."""
        return self._state
    
    def before(self, handler: Handler) -> None:
        """
        Add a preprocessing handler that runs before the main handler.
        
        The before handler receives the payload and can:
        - Transform it before passing to main handler
        - Return early to skip main handler
        
        Note: Only one before handler is supported.
        
        Example:
            service.before(async def preprocess(payload, request):
                payload['timestamp'] = time.time()
                return payload  # Modified payload passed to main handler
            )
        """
        original_handler = self._server.handler
        
        async def preprocessing_handler(payload, request):
            result = handler(payload, request)
            # Handle both sync and async before handlers
            if asyncio.iscoroutine(result):
                result = await result
            if result is None:
                # Before handler returned nothing, skip main handler
                return None
            # Pass transformed payload to main handler
            return await original_handler(result, request)
        
        self._server.handler = preprocessing_handler
        self._before_handler = handler
    
    async def terminate(self) -> None:
        """Stop service and unregister from registry."""
        logger.info(f"Terminating service {self.name}...")
        
        # Unregister from registry
        try:
            registry_host = env_config.get_required('YAMF_REGISTRY_URL')
            registry_token = env_config.get('YAMF_REGISTRY_TOKEN')
            
            headers = build_unregister_headers(self.name, self.location, registry_token)
            await http_request(registry_host, headers=headers)
            logger.debug(f"Unregistered {self.name} from registry")
        except Exception as e:
            logger.error(f"Error unregistering service: {e}")
        
        # Remove from local cache
        self._state.remove_service(self.name, self.location)
        
        # Stop HTTP server
        await self._server.stop()
        
        logger.info(f"Service {self.name} terminated")
    
    async def __aenter__(self) -> YamfService:
        return self
    
    async def __aexit__(self, *args) -> None:
        await self.terminate()


def _validate_service_name(name: str) -> None:
    """Validate service name format."""
    if not name or not isinstance(name, str):
        raise ValueError("Service name must be a non-empty string")
    if ' ' in name:
        raise ValueError("Service name cannot contain spaces")


def _get_service_home() -> str:
    """Determine service home URL from config."""
    service_host = env_config.get('YAMF_SERVICE_URL')
    registry_host = env_config.get_required('YAMF_REGISTRY_URL')
    
    if service_host:
        logger.debug(f"Using configured service host: {service_host}")
        return service_host
    
    # Strip port from registry host
    service_home = re.sub(r':\d+$', '', registry_host)
    logger.debug(f"Derived service home from registry: {service_home}")
    return service_home


async def _setup_with_registry(
    service_name: str,
    service_home: str,
    registry_token: Optional[str]
) -> str:
    """Request port allocation from registry."""
    registry_host = env_config.get_required('YAMF_REGISTRY_URL')
    
    logger.debug(f"Setting up service {service_name} with registry...")
    
    headers = build_setup_headers(service_name, service_home, registry_token)
    location = await http_request(registry_host, headers=headers)
    
    logger.debug(f"Registry allocated location: {location}")
    return location


async def _register_with_registry(
    service_name: str,
    location: str,
    use_auth_service: Optional[str],
    registry_token: Optional[str]
) -> dict:
    """Register service with registry."""
    registry_host = env_config.get_required('YAMF_REGISTRY_URL')
    
    logger.debug(f"Registering service {service_name} at {location}...")
    
    headers = build_register_headers(service_name, location, use_auth_service, registry_token)
    registry_data = await http_request(registry_host, headers=headers)
    
    logger.debug(f"Service {service_name} registered")
    return registry_data


async def create_service(
    name_or_fn: str | Handler,
    handler: Optional[Handler] = None,
    *,
    use_auth_service: Optional[str] = None,
    stream_payload: bool = False,
    shared_cache: Optional[ServiceState] = None
) -> YamfService:
    """
    Create and register an RPC service.
    
    Args:
        name_or_fn: Service name (str) or named handler function
        handler: Handler function (required if name_or_fn is str)
        use_auth_service: Name of auth service for protected endpoints
        stream_payload: If True, pass raw request body to handler
        shared_cache: Optional pre-created cache for batch operations
    
    Returns:
        YamfService instance
    
    Example:
        # With explicit name
        async def my_handler(self, payload):
            return {'result': payload['input'] * 2}
        
        service = await create_service('my_service', my_handler)
        
        # With named function (uses function name)
        async def my_service(self, payload):
            return {'result': payload['input'] * 2}
        
        service = await create_service(my_service)
    
    Environment Variables:
        YAMF_REGISTRY_URL: Required. Registry server URL.
        YAMF_REGISTRY_TOKEN: Optional. Authentication token.
        YAMF_SERVICE_URL: Optional. Override service home URL.
    """
    # Handle function-first calling style
    if callable(name_or_fn):
        service_fn = name_or_fn
        name = getattr(service_fn, '__name__', None)
        if not name or name == '<lambda>':
            name = f"Anon_{secrets.token_hex(4)}"
            logger.debug(f"Generated anonymous service name: {name}")
    else:
        name = name_or_fn
        service_fn = handler
        if not callable(service_fn):
            raise ValueError("Handler must be a callable function")
    
    _validate_service_name(name)
    
    registry_token = env_config.get('YAMF_REGISTRY_TOKEN')
    service_home = _get_service_home()
    
    # Setup: get port allocation
    location = await _setup_with_registry(name, service_home, registry_token)
    port = int(location.split(':')[-1])
    
    # Create service state and context
    state = shared_cache or ServiceState()
    context = ServiceContext(state, name)
    
    # Bind handler to context and wrap with cache awareness
    bound_handler = bind_handler(service_fn, context)
    
    async def request_handler(payload, request):
        result = bound_handler(payload)
        # Handle both sync and async handlers
        if asyncio.iscoroutine(result):
            return await result
        return result
    
    cache_aware_handler = create_cache_aware_handler(request_handler, state, context)
    
    # Create HTTP server
    retry_limit = env_config.get('YAMF_REGISTRATION_RETRY_LIMIT', 50)
    attempts = 0
    server = None
    
    while server is None:
        try:
            server = await create_http_server(
                port, 
                cache_aware_handler,
                stream_payload=stream_payload
            )
        except OSError as e:
            if 'Address already in use' in str(e):
                attempts += 1
                if attempts >= retry_limit:
                    raise RegistrationError(name, f"Failed to allocate port after {retry_limit} attempts")
                
                logger.debug(f"Port {port} in use, retrying...")
                # Request new port
                location = await _setup_with_registry(name, service_home, registry_token)
                port = int(location.split(':')[-1])
            else:
                raise
    
    # Register with registry
    try:
        registry_data = await _register_with_registry(
            name, location, use_auth_service, registry_token
        )
    except Exception as e:
        await server.stop()
        raise RegistrationError(name, str(e)) from e
    
    # Update local cache with registry data
    state.update_from_registry(registry_data)
    
    logger.info(f"Service '{name}' running at {location}")
    
    return YamfService(
        name=name,
        location=location,
        port=port,
        _context=context,
        _state=state,
        _server=server,
        _handler=service_fn,
    )
