"""
YAMF Create Route

Register URL routes that map to services.
"""

import logging
from typing import Any, Callable, Awaitable, Optional

from ..config import env_config
from ..errors import YamfError
from ..headers import build_route_register_headers
from ..http.client import http_request
from .create_service import create_service, YamfService

logger = logging.getLogger('yamf.api')

Handler = Callable[[Any], Awaitable[Any]]


async def create_route(
    path: str,
    service_or_handler: str | Handler,
    *,
    data_type: str = 'application/json',
    route_type: str = 'route'
) -> Optional[YamfService]:
    """
    Create a route mapping a URL path to a service.
    
    Routes allow services to be accessed via the gateway at specific paths
    instead of (or in addition to) by service name.
    
    Args:
        path: URL path (e.g., '/api/users')
        service_or_handler: Service name (str) or handler function
        data_type: Content type for the route (default: application/json)
        route_type: Route type ('route' or 'controller')
    
    Returns:
        YamfService if handler function was provided, None if service name
    
    Example:
        # Route to existing service
        await create_route('/api/users', 'user_service')
        
        # Route with inline handler (creates service automatically)
        async def get_users(self, payload):
            return await self.call('user_service', {'action': 'list'})
        
        service = await create_route('/api/users', get_users)
    """
    registry_host = env_config.get_required('YAMF_REGISTRY_URL')
    registry_token = env_config.get('YAMF_REGISTRY_TOKEN')
    
    service = None
    
    # If handler function provided, create service first
    if callable(service_or_handler):
        service = await create_service(service_or_handler)
        service_name = service.name
    else:
        service_name = service_or_handler
    
    # Register route with registry
    logger.debug(f"Registering route {path} -> {service_name}")
    
    headers = build_route_register_headers(
        service_name, path, data_type, route_type, registry_token
    )
    
    try:
        await http_request(registry_host, headers=headers)
    except Exception as e:
        # Cleanup service if we created one
        if service:
            await service.terminate()
        raise YamfError(500, f"Failed to register route: {e}") from e
    
    logger.info(f"Route '{path}' -> service '{service_name}'")
    
    return service
