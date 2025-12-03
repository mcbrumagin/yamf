"""
YAMF Cache-Aware Handler

Wraps service handlers to intercept cache update notifications from registry.
"""

import logging
from typing import Any, Callable, Awaitable
from aiohttp import web

from ..constants import Command
from ..headers import parse_command_headers
from .state import ServiceState
from .context import ServiceContext

logger = logging.getLogger('yamf.service')

Handler = Callable[[Any, web.Request], Awaitable[Any]]


def is_cache_update_request(request: web.Request) -> bool:
    """Check if request is a cache update from registry."""
    if not request or not hasattr(request, 'headers'):
        return False
    
    headers = parse_command_headers(dict(request.headers))
    return headers.get('command') == Command.CACHE_UPDATE.value


def is_subscription_message(request: web.Request) -> bool:
    """Check if request is a subscription message delivery."""
    if not request or not hasattr(request, 'headers'):
        return False
    
    headers = parse_command_headers(dict(request.headers))
    return headers.get('command') == Command.PUBSUB_PUBLISH.value


def create_cache_aware_handler(
    service_handler: Handler,
    state: ServiceState,
    context: ServiceContext
) -> Handler:
    """
    Wrap a service handler to intercept cache updates.
    
    The wrapped handler:
    1. Intercepts cache-update commands from registry and updates local state
    2. Forwards all other requests to the actual service handler
    
    Args:
        service_handler: The actual service handler function
        state: Service state (cache) to update
        context: Service context to refresh after cache updates
    
    Returns:
        Wrapped handler function
    """
    
    async def cache_aware_handler(payload: Any, request: web.Request) -> Any:
        # Check for cache update from registry
        if is_cache_update_request(request):
            headers = parse_command_headers(dict(request.headers))
            
            pubsub_channel = headers.get('pubsub_channel')
            service_name = headers.get('service_name')
            service_location = headers.get('service_location')
            
            logger.debug(
                f"cache_aware_handler - cache update: "
                f"channel={pubsub_channel}, service={service_name}, location={service_location}"
            )
            
            # Update local cache
            if pubsub_channel and pubsub_channel != 'undefined':
                # Subscription update
                state.add_subscription(pubsub_channel, service_location)
            elif service_name and service_name != 'undefined':
                # Service update
                state.add_service(service_name, service_location)
            
            # Refresh context
            context._update_from_cache()
            
            return {
                'status': 'cache_updated',
                'subscription': pubsub_channel,
                'service': service_name,
                'location': service_location,
            }
        
        # Normal service request - delegate to handler
        return await service_handler(payload, request)
    
    return cache_aware_handler

