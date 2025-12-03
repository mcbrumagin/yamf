"""
YAMF Call Service

Call other services by name, either through registry or directly via cache.
"""

import logging
from typing import Any, Optional

from ..config import env_config
from ..errors import HttpError, ServiceNotFoundError
from ..headers import build_call_headers
from ..http.client import http_request
from ..service.state import ServiceState

logger = logging.getLogger('yamf.api')


async def call_service(
    name: str,
    payload: Any = None,
    *,
    content_type: str = 'application/json',
    auth_token: Optional[str] = None
) -> Any:
    """
    Call a service by name through the registry.
    
    This routes through the registry which handles:
    - Service lookup
    - Load balancing
    - Auth validation (if service uses auth)
    
    Args:
        name: Service name to call
        payload: Request payload (will be JSON serialized)
        content_type: Content type header (default: application/json)
        auth_token: Optional auth token for protected services
    
    Returns:
        Service response (parsed JSON or raw text)
    
    Example:
        result = await call_service('user_service', {'user_id': 123})
        print(result['name'])
    """
    registry_host = env_config.get_required('YAMF_REGISTRY_URL')
    
    logger.debug(f"call_service: {name}")
    
    headers = build_call_headers(name, auth_token)
    headers['Content-Type'] = content_type
    
    return await http_request(registry_host, headers=headers, body=payload)


async def call_service_with_cache(
    cache: ServiceState,
    name: str,
    payload: Any = None
) -> Any:
    """
    Call a service using cached location for direct communication.
    
    This bypasses the registry for the actual call, using the locally
    cached service location. Falls back to registry if service not in cache.
    
    Benefits:
    - Lower latency (no registry hop)
    - Reduced registry load
    
    Args:
        cache: ServiceState with cached service locations
        name: Service name to call
        payload: Request payload
    
    Returns:
        Service response
    
    Raises:
        ServiceNotFoundError: If service not in cache
    """
    # Handle case where name might be a function (for autocomplete stubs)
    if callable(name):
        name = getattr(name, '__name__', str(name))
    
    if not cache.has_service(name):
        raise ServiceNotFoundError(name)
    
    location = cache.get_location(name)
    if not location:
        raise ServiceNotFoundError(name)
    
    logger.debug(f"call_service_with_cache: {name} -> {location}")
    
    return await http_request(location, body=payload)
