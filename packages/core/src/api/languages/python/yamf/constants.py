"""
YAMF Protocol Constants

Header names and command values for the yamf protocol.
Using str+Enum mixin allows direct use as dict keys.
"""

from enum import Enum


class Header(str, Enum):
    """HTTP header names for yamf protocol."""
    
    # Command routing
    COMMAND = 'yamf-command'
    
    # Service operations
    SERVICE_NAME = 'yamf-service-name'
    SERVICE_LOCATION = 'yamf-service-location'
    SERVICE_HOME = 'yamf-service-home'
    USE_AUTH_SERVICE = 'yamf-use-auth-service'
    
    # Authentication
    AUTH_TOKEN = 'yamf-auth-token'
    REGISTRY_TOKEN = 'yamf-registry-token'
    
    # Route operations
    ROUTE_PATH = 'yamf-route-path'
    ROUTE_DATATYPE = 'yamf-route-datatype'
    ROUTE_TYPE = 'yamf-route-type'
    
    # Pub/sub operations
    PUBSUB_CHANNEL = 'yamf-pubsub-channel'


class Command(str, Enum):
    """Command values for yamf-command header."""
    
    # Shared
    HEALTH = 'health'
    
    # Registry operations
    SERVICE_SETUP = 'service-setup'
    SERVICE_REGISTER = 'service-register'
    SERVICE_UNREGISTER = 'service-unregister'
    SERVICE_LOOKUP = 'service-lookup'
    SERVICE_CALL = 'service-call'
    ROUTE_REGISTER = 'route-register'
    
    # Pub/sub
    PUBSUB_PUBLISH = 'pubsub-publish'
    PUBSUB_SUBSCRIBE = 'pubsub-subscribe'
    PUBSUB_UNSUBSCRIBE = 'pubsub-unsubscribe'
    
    # Gateway
    REGISTRY_UPDATED = 'registry-updated'
    REGISTRY_PULL = 'registry-pull'
    GATEWAY_PULL = 'gateway-pull'
    
    # Authentication
    AUTH_LOGIN = 'auth-login'
    AUTH_REFRESH = 'auth-refresh'
    
    # Service
    CACHE_UPDATE = 'cache-update'


# Commands that should NOT JSON parse the body (need raw stream)
STREAM_COMMANDS = frozenset([
    Command.SERVICE_CALL.value,
])


def should_skip_json_parsing(command: str) -> bool:
    """Check if command should skip JSON body parsing."""
    return command in STREAM_COMMANDS

