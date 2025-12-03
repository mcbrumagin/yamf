"""
YAMF Publish Message

Publish messages to pub/sub channels.
"""

import logging
from typing import Any

from ..config import env_config
from ..headers import build_publish_headers
from ..http.client import http_request

logger = logging.getLogger('yamf.api')


async def publish_message(channel: str, message: Any = None) -> dict:
    """
    Publish a message to a pub/sub channel.
    
    Messages are delivered to all services subscribed to the channel.
    
    Args:
        channel: Channel name to publish to
        message: Message payload (will be JSON serialized)
    
    Returns:
        Dict with 'results' and 'errors' from subscribers
    
    Example:
        # Publish event
        await publish_message('user.created', {
            'user_id': 123,
            'email': 'user@example.com'
        })
        
        # Fire and forget
        await publish_message('metrics.pageview', {'page': '/home'})
    """
    registry_host = env_config.get_required('YAMF_REGISTRY_URL')
    registry_token = env_config.get('YAMF_REGISTRY_TOKEN')
    
    logger.debug(f"publish_message: {channel}")
    
    headers = build_publish_headers(channel, registry_token)
    
    return await http_request(registry_host, headers=headers, body=message)
