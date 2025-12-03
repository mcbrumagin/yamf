"""
YAMF PubSub Manager

Manages pub/sub subscriptions for subscription services.
"""

import asyncio
import time
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

from ..config import env_config
from ..http.client import http_request
from ..headers import build_subscribe_headers, build_unsubscribe_headers

logger = logging.getLogger('yamf.pubsub')

Handler = Callable[[Any], Awaitable[Any]]


@dataclass
class PubSubManager:
    """
    Manages pub/sub subscriptions for a service.
    
    Handles:
    - Registering subscriptions with the registry
    - Dispatching incoming messages to handlers
    - Cleanup on service termination
    """
    
    service_name: str
    service_location: str
    _handlers: dict[str, dict[str, Handler]] = field(default_factory=dict)
    _counter: int = 0
    _registry_host: str = field(default='', init=False)
    _registry_token: str | None = field(default=None, init=False)
    
    def __post_init__(self):
        self._registry_host = env_config.get_required('YAMF_REGISTRY_URL')
        self._registry_token = env_config.get('YAMF_REGISTRY_TOKEN')
    
    async def subscribe(self, channel: str, handler: Handler) -> str:
        """
        Subscribe to a channel with a handler.
        
        Args:
            channel: Channel name to subscribe to
            handler: Async function to handle messages
        
        Returns:
            Subscription ID (for unsubscribe)
        """
        if not callable(handler):
            raise ValueError("Handler must be callable")
        
        self._counter += 1
        sub_id = f"sub_{channel}_{self._counter}_{int(time.time() * 1000)}"
        
        # First subscription to this channel - register with registry
        if channel not in self._handlers:
            self._handlers[channel] = {}
            headers = build_subscribe_headers(
                channel, self.service_location, self._registry_token
            )
            await http_request(self._registry_host, headers=headers)
            logger.debug(f"Registered subscription for channel: {channel}")
        
        self._handlers[channel][sub_id] = handler
        logger.debug(f"Added handler {sub_id} for channel {channel}")
        return sub_id
    
    async def unsubscribe(self, channel: str, sub_id: str) -> None:
        """
        Unsubscribe a specific handler.
        
        Args:
            channel: Channel name
            sub_id: Subscription ID from subscribe()
        """
        if channel not in self._handlers or sub_id not in self._handlers[channel]:
            raise ValueError(f"Subscription {sub_id} not found for channel {channel}")
        
        del self._handlers[channel][sub_id]
        logger.debug(f"Removed handler {sub_id} from channel {channel}")
        
        # Last handler for this channel - unregister from registry
        if not self._handlers[channel]:
            del self._handlers[channel]
            headers = build_unsubscribe_headers(
                channel, self.service_location, self._registry_token
            )
            await http_request(self._registry_host, headers=headers)
            logger.debug(f"Unregistered subscription for channel: {channel}")
    
    async def handle_message(self, channel: str, message: Any) -> dict:
        """
        Dispatch incoming message to all handlers for a channel.
        
        Args:
            channel: Channel the message arrived on
            message: Message payload
        
        Returns:
            Dict with 'results' and 'errors' lists
        """
        if channel not in self._handlers:
            return {
                'results': [],
                'errors': [f'No handlers for channel {channel}']
            }
        
        results = []
        errors = []
        
        for sub_id, handler in self._handlers[channel].items():
            try:
                result = handler(message)
                # Handle both sync and async handlers
                if asyncio.iscoroutine(result):
                    result = await result
                results.append(result)
            except Exception as e:
                logger.error(f"Handler {sub_id} error for channel {channel}: {e}")
                errors.append({
                    'subId': sub_id,
                    'error': str(e),
                    'status': 500
                })
        
        return {'results': results, 'errors': errors}
    
    def list_subscriptions(self) -> dict:
        """List all active subscriptions."""
        return {
            channel: {
                'location': self.service_location,
                'subscriptions': list(handlers.keys())
            }
            for channel, handlers in self._handlers.items()
        }
    
    def has_channel(self, channel: str) -> bool:
        """Check if we have handlers for a channel."""
        return channel in self._handlers and len(self._handlers[channel]) > 0
    
    async def cleanup(self) -> None:
        """Unsubscribe from all channels."""
        for channel in list(self._handlers.keys()):
            try:
                headers = build_unsubscribe_headers(
                    channel, self.service_location, self._registry_token
                )
                await http_request(self._registry_host, headers=headers)
                logger.debug(f"Cleanup: unsubscribed from {channel}")
            except Exception as e:
                logger.warning(f"Failed to unsubscribe from {channel}: {e}")
            del self._handlers[channel]

