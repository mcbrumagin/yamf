"""
YAMF Service Context

Execution context passed to service handlers with access to other services.
"""

from __future__ import annotations
import logging
from typing import TYPE_CHECKING, Any, Callable, Awaitable

if TYPE_CHECKING:
    from .state import ServiceState

logger = logging.getLogger('yamf.service')


class ServiceContext:
    """
    Execution context passed to service handlers.
    
    Provides:
    - call(service_name, payload): RPC to other services
    - publish(channel, message): Publish to pub/sub channels
    - Dynamic attribute access: context.user_service(payload)
    
    Example:
        async def my_handler(self, payload):
            # Using call()
            user = await self.call('user_service', {'id': payload['user_id']})
            
            # Using dynamic stub
            user = await self.user_service({'id': payload['user_id']})
            
            # Publishing events
            await self.publish('user.accessed', {'user_id': user['id']})
            
            return {'user': user}
    """
    
    def __init__(self, state: ServiceState, service_name: str = 'anonymous'):
        self._state = state
        self._service_name = service_name
    
    @property
    def cache(self) -> ServiceState:
        """Access to the service state cache."""
        return self._state
    
    async def call(self, service_name: str, payload: Any = None) -> Any:
        """
        Call another service by name.
        
        Uses cached service locations for direct calls when available,
        otherwise routes through the registry.
        """
        from ..api.call_service import call_service_with_cache
        return await call_service_with_cache(self._state, service_name, payload)
    
    async def publish(self, channel: str, message: Any = None) -> dict:
        """
        Publish a message to a pub/sub channel.
        
        Messages are delivered to all subscribers of the channel.
        """
        from ..api.publish_message import publish_message
        return await publish_message(channel, message)
    
    def __getattr__(self, name: str) -> Callable[[Any], Awaitable[Any]]:
        """
        Dynamic attribute access for service stubs.
        
        Allows: context.user_service(payload)
        Instead of: context.call('user_service', payload)
        
        Only works for services currently in the cache.
        """
        if name.startswith('_'):
            raise AttributeError(name)
        
        if self._state.has_service(name):
            async def service_stub(payload: Any = None) -> Any:
                return await self.call(name, payload)
            return service_stub
        
        raise AttributeError(
            f"'{type(self).__name__}' has no attribute '{name}' "
            f"(service '{name}' not in cache)"
        )
    
    def _update_from_cache(self) -> None:
        """
        Refresh context after cache update.
        
        Called internally when registry notifies of changes.
        Currently a no-op since we use __getattr__ for dynamic access.
        """
        pass


def bind_handler(handler: Callable, context: ServiceContext) -> Callable:
    """
    Bind a handler function to a context.
    
    The handler will receive the context as `self` when called.
    """
    return handler.__get__(context, type(context))

