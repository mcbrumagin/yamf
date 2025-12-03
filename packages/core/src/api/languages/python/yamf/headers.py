"""
YAMF Header Builders

Functions to build header dicts for various yamf protocol operations.

Note: We use .value explicitly on enums to ensure aiohttp gets plain strings.
"""

from typing import Optional
from .constants import Header, Command


def build_setup_headers(
    service_name: str,
    service_home: str,
    registry_token: Optional[str] = None
) -> dict[str, str]:
    """Build headers for service setup (port allocation) request."""
    headers = {
        Header.COMMAND.value: Command.SERVICE_SETUP.value,
        Header.SERVICE_NAME.value: service_name,
        Header.SERVICE_HOME.value: service_home,
    }
    if registry_token:
        headers[Header.REGISTRY_TOKEN.value] = registry_token
    return headers


def build_register_headers(
    service_name: str,
    location: str,
    use_auth_service: Optional[str] = None,
    registry_token: Optional[str] = None
) -> dict[str, str]:
    """Build headers for service registration."""
    headers = {
        Header.COMMAND.value: Command.SERVICE_REGISTER.value,
        Header.SERVICE_NAME.value: service_name,
        Header.SERVICE_LOCATION.value: location,
    }
    if use_auth_service:
        headers[Header.USE_AUTH_SERVICE.value] = use_auth_service
    if registry_token:
        headers[Header.REGISTRY_TOKEN.value] = registry_token
    return headers


def build_unregister_headers(
    service_name: str,
    location: str,
    registry_token: Optional[str] = None
) -> dict[str, str]:
    """Build headers for service unregistration."""
    headers = {
        Header.COMMAND.value: Command.SERVICE_UNREGISTER.value,
        Header.SERVICE_NAME.value: service_name,
        Header.SERVICE_LOCATION.value: location,
    }
    if registry_token:
        headers[Header.REGISTRY_TOKEN.value] = registry_token
    return headers


def build_lookup_headers(service_name: str) -> dict[str, str]:
    """Build headers for service lookup."""
    return {
        Header.COMMAND.value: Command.SERVICE_LOOKUP.value,
        Header.SERVICE_NAME.value: service_name,
    }


def build_call_headers(
    service_name: str,
    auth_token: Optional[str] = None
) -> dict[str, str]:
    """Build headers for service call."""
    headers = {
        Header.COMMAND.value: Command.SERVICE_CALL.value,
        Header.SERVICE_NAME.value: service_name,
    }
    if auth_token:
        headers[Header.AUTH_TOKEN.value] = auth_token
    return headers


def build_route_register_headers(
    service_name: str,
    route_path: str,
    data_type: str = 'application/json',
    route_type: str = 'route',
    registry_token: Optional[str] = None
) -> dict[str, str]:
    """Build headers for route registration."""
    headers = {
        Header.COMMAND.value: Command.ROUTE_REGISTER.value,
        Header.SERVICE_NAME.value: service_name,
        Header.ROUTE_PATH.value: route_path,
        Header.ROUTE_DATATYPE.value: data_type,
        Header.ROUTE_TYPE.value: route_type,
    }
    if registry_token:
        headers[Header.REGISTRY_TOKEN.value] = registry_token
    return headers


def build_publish_headers(
    channel: str,
    registry_token: Optional[str] = None
) -> dict[str, str]:
    """Build headers for pub/sub publish."""
    headers = {
        Header.COMMAND.value: Command.PUBSUB_PUBLISH.value,
        Header.PUBSUB_CHANNEL.value: channel,
    }
    if registry_token:
        headers[Header.REGISTRY_TOKEN.value] = registry_token
    return headers


def build_subscribe_headers(
    channel: str,
    location: str,
    registry_token: Optional[str] = None
) -> dict[str, str]:
    """Build headers for pub/sub subscribe."""
    headers = {
        Header.COMMAND.value: Command.PUBSUB_SUBSCRIBE.value,
        Header.PUBSUB_CHANNEL.value: channel,
        Header.SERVICE_LOCATION.value: location,
    }
    if registry_token:
        headers[Header.REGISTRY_TOKEN.value] = registry_token
    return headers


def build_unsubscribe_headers(
    channel: str,
    location: str,
    registry_token: Optional[str] = None
) -> dict[str, str]:
    """Build headers for pub/sub unsubscribe."""
    headers = {
        Header.COMMAND.value: Command.PUBSUB_UNSUBSCRIBE.value,
        Header.PUBSUB_CHANNEL.value: channel,
        Header.SERVICE_LOCATION.value: location,
    }
    if registry_token:
        headers[Header.REGISTRY_TOKEN.value] = registry_token
    return headers


def build_cache_update_headers(
    pubsub_channel: str,
    service_name: str,
    location: str
) -> dict[str, str]:
    """Build headers for cache update notification."""
    return {
        Header.COMMAND.value: Command.CACHE_UPDATE.value,
        Header.PUBSUB_CHANNEL.value: pubsub_channel,
        Header.SERVICE_NAME.value: service_name,
        Header.SERVICE_LOCATION.value: location,
    }


def parse_command_headers(headers: dict[str, str]) -> dict[str, Optional[str]]:
    """Parse command-related headers from a request."""
    return {
        'command': headers.get(Header.COMMAND.value),
        'service_name': headers.get(Header.SERVICE_NAME.value),
        'service_location': headers.get(Header.SERVICE_LOCATION.value),
        'use_auth_service': headers.get(Header.USE_AUTH_SERVICE.value),
        'service_home': headers.get(Header.SERVICE_HOME.value),
        'route_path': headers.get(Header.ROUTE_PATH.value),
        'route_data_type': headers.get(Header.ROUTE_DATATYPE.value),
        'route_type': headers.get(Header.ROUTE_TYPE.value),
        'pubsub_channel': headers.get(Header.PUBSUB_CHANNEL.value),
    }


def is_header_based_command(headers: dict[str, str]) -> bool:
    """Check if headers contain a yamf command."""
    return Header.COMMAND.value in headers

