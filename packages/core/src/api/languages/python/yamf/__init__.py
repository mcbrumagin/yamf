"""
YAMF - Yet Another Microservices Framework

Python client library for the yamf microservices framework.

Quick Start:
    from yamf import create_service, call_service
    
    async def my_handler(self, payload):
        # Call another service
        user = await self.call('user_service', {'id': payload['user_id']})
        return {'greeting': f"Hello, {user['name']}!"}
    
    service = await create_service('greeting_service', my_handler)

For subscription services:
    from yamf import create_subscription_service
    
    async def on_user_created(message):
        await send_welcome_email(message['email'])
    
    service = await create_subscription_service({
        'user.created': on_user_created
    })
"""

__version__ = '1.0.0'

# Core API functions
from .api import (
    create_service,
    create_subscription_service,
    call_service,
    create_route,
    publish_message,
    YamfService,
    SubscriptionService,
)

# Service internals (for advanced use)
from .service import (
    ServiceState,
    ServiceContext,
    PubSubManager,
)

# Configuration
from .config import env_config

# Errors
from .errors import (
    YamfError,
    HttpError,
    ConfigError,
    ServiceNotFoundError,
    RegistrationError,
)

# Protocol constants
from .constants import Header, Command

# Header builders (for advanced use)
from .headers import (
    build_setup_headers,
    build_register_headers,
    build_unregister_headers,
    build_call_headers,
    build_publish_headers,
    build_subscribe_headers,
    build_unsubscribe_headers,
    parse_command_headers,
)

__all__ = [
    # Version
    '__version__',
    
    # Core API
    'create_service',
    'create_subscription_service',
    'call_service',
    'create_route',
    'publish_message',
    
    # Service classes
    'YamfService',
    'SubscriptionService',
    'ServiceState',
    'ServiceContext',
    'PubSubManager',
    
    # Configuration
    'env_config',
    
    # Errors
    'YamfError',
    'HttpError',
    'ConfigError',
    'ServiceNotFoundError',
    'RegistrationError',
    
    # Constants
    'Header',
    'Command',
    
    # Header builders
    'build_setup_headers',
    'build_register_headers',
    'build_unregister_headers',
    'build_call_headers',
    'build_publish_headers',
    'build_subscribe_headers',
    'build_unsubscribe_headers',
    'parse_command_headers',
]
