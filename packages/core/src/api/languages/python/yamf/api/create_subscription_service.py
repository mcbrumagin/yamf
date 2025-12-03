"""
YAMF Create Subscription Service

Create pub/sub subscription services that react to events.
"""

from __future__ import annotations
import re
import secrets
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable, Optional

from ..config import env_config
from ..errors import RegistrationError
from ..headers import (
    build_setup_headers, 
    build_register_headers, 
    build_unregister_headers,
    parse_command_headers
)
from ..constants import Command
from ..http.client import http_request
from ..http.server import create_http_server, HttpServer
from ..service.state import ServiceState
from ..service.context import ServiceContext
from ..service.pubsub import PubSubManager
from ..service.handler import is_subscription_message

logger = logging.getLogger('yamf.api')

Handler = Callable[[Any], Awaitable[Any]]


@dataclass
class SubscriptionService:
    """
    A registered yamf subscription service.
    
    Unlike regular services, subscription services:
    - Subscribe to one or more pub/sub channels
    - React to events rather than responding to requests
    - Can still call other services and publish events
    
    Example:
        service = await create_subscription_service({
            'user.created': async def(message):
                await send_welcome_email(message['email'])
            ,
            'user.deleted': async def(message):
                await cleanup_user_data(message['user_id'])
        })
    """
    
    name: str
    location: str
    port: int
    channels: list[str]
    
    _context: ServiceContext
    _state: ServiceState
    _server: HttpServer
    _pubsub: PubSubManager
    
    @property
    def context(self) -> ServiceContext:
        """Service execution context with call() and publish()."""
        return self._context
    
    @property
    def cache(self) -> ServiceState:
        """Local cache of registry state."""
        return self._state
    
    def subscriptions(self) -> dict:
        """List active subscriptions."""
        return self._pubsub.list_subscriptions()
    
    async def terminate(self) -> None:
        """Stop service, unsubscribe from channels, and unregister."""
        logger.info(f"Terminating subscription service {self.name}...")
        
        # Unsubscribe from all channels
        await self._pubsub.cleanup()
        
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
        
        logger.info(f"Subscription service {self.name} terminated")
    
    async def __aenter__(self) -> SubscriptionService:
        return self
    
    async def __aexit__(self, *args) -> None:
        await self.terminate()


def _get_service_home() -> str:
    """Determine service home URL from config."""
    service_host = env_config.get('YAMF_SERVICE_URL')
    registry_host = env_config.get_required('YAMF_REGISTRY_URL')
    
    if service_host:
        return service_host
    
    return re.sub(r':\d+$', '', registry_host)


async def create_subscription_service(
    channel_map: dict[str, Handler],
    *,
    name: Optional[str] = None,
    shared_cache: Optional[ServiceState] = None
) -> SubscriptionService:
    """
    Create a subscription service that handles pub/sub events.
    
    Args:
        channel_map: Dict mapping channel names to handler functions
        name: Optional service name (generated if not provided)
        shared_cache: Optional pre-created cache for batch operations
    
    Returns:
        SubscriptionService instance
    
    Example:
        async def on_user_created(message):
            print(f"User created: {message['user_id']}")
            await send_welcome_email(message['email'])
        
        async def on_user_updated(message):
            await invalidate_cache(message['user_id'])
        
        service = await create_subscription_service({
            'user.created': on_user_created,
            'user.updated': on_user_updated,
        })
    
    Environment Variables:
        YAMF_REGISTRY_URL: Required. Registry server URL.
        YAMF_REGISTRY_TOKEN: Optional. Authentication token.
    """
    if not channel_map:
        raise ValueError("At least one channel subscription is required")
    
    # Validate all handlers
    for channel, handler in channel_map.items():
        if not callable(handler):
            raise ValueError(f"Handler for channel '{channel}' must be callable")
    
    # Generate name if not provided
    channels = list(channel_map.keys())
    if not name:
        channel_suffix = channels[0].replace('.', '_')
        name = f"subscription_{channel_suffix}_{secrets.token_hex(4)}"
    
    registry_token = env_config.get('YAMF_REGISTRY_TOKEN')
    service_home = _get_service_home()
    
    # Setup: get port allocation
    registry_host = env_config.get_required('YAMF_REGISTRY_URL')
    headers = build_setup_headers(name, service_home, registry_token)
    location = await http_request(registry_host, headers=headers)
    port = int(location.split(':')[-1])
    
    # Create service state and context
    state = shared_cache or ServiceState()
    context = ServiceContext(state, name)
    
    # Create pubsub manager
    pubsub = PubSubManager(name, location)
    
    # Create request handler for subscription messages
    async def subscription_handler(payload, request):
        if is_subscription_message(request):
            headers = parse_command_headers(dict(request.headers))
            channel = headers.get('pubsub_channel')
            
            if channel and pubsub.has_channel(channel):
                logger.debug(f"Handling subscription message for channel: {channel}")
                return await pubsub.handle_message(channel, payload)
            else:
                logger.warning(f"Received message for unknown channel: {channel}")
                return {'error': f'No handler for channel {channel}'}
        
        # Not a subscription message - return error
        return {'error': 'This is a subscription-only service'}
    
    # Create HTTP server
    retry_limit = env_config.get('YAMF_REGISTRATION_RETRY_LIMIT', 50)
    attempts = 0
    server = None
    
    while server is None:
        try:
            server = await create_http_server(port, subscription_handler)
        except OSError as e:
            if 'Address already in use' in str(e):
                attempts += 1
                if attempts >= retry_limit:
                    raise RegistrationError(name, f"Failed to allocate port after {retry_limit} attempts")
                
                logger.debug(f"Port {port} in use, retrying...")
                headers = build_setup_headers(name, service_home, registry_token)
                location = await http_request(registry_host, headers=headers)
                port = int(location.split(':')[-1])
                # Update pubsub manager location
                pubsub.service_location = location
            else:
                raise
    
    # Register with registry
    try:
        headers = build_register_headers(name, location, None, registry_token)
        registry_data = await http_request(registry_host, headers=headers)
    except Exception as e:
        await server.stop()
        raise RegistrationError(name, str(e)) from e
    
    # Update local cache
    state.update_from_registry(registry_data)
    
    # Subscribe to all channels
    for channel, handler in channel_map.items():
        await pubsub.subscribe(channel, handler)
    
    logger.info(f"Subscription service '{name}' running at {location}")
    logger.info(f"  Subscribed to channels: {', '.join(channels)}")
    
    return SubscriptionService(
        name=name,
        location=location,
        port=port,
        channels=channels,
        _context=context,
        _state=state,
        _server=server,
        _pubsub=pubsub,
    )
