"""
YAMF Service State

Local cache of registry state for efficient service-to-service calls.
"""

import random
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger('yamf.service')


@dataclass
class ServiceState:
    """
    Local cache of registry state.
    
    Maintains:
    - services: service name -> list of locations
    - addresses: location -> service name (reverse lookup)
    - subscriptions: channel -> list of subscriber locations
    """
    
    services: dict[str, list[str]] = field(default_factory=dict)
    addresses: dict[str, str] = field(default_factory=dict)
    subscriptions: dict[str, list[str]] = field(default_factory=dict)
    
    def update_from_registry(self, registry_data: dict) -> None:
        """Update cache with full registry data."""
        if 'services' in registry_data:
            self.services = registry_data['services']
        if 'addresses' in registry_data:
            self.addresses = registry_data['addresses']
        if 'subscriptions' in registry_data:
            self.subscriptions = registry_data['subscriptions']
    
    def add_service(self, name: str, location: str) -> None:
        """Add a service location to cache."""
        logger.debug(f"add_service: {name} at {location}")
        self.addresses[location] = name
        if name not in self.services:
            self.services[name] = []
        if location not in self.services[name]:
            self.services[name].append(location)
    
    def remove_service(self, name: str, location: str) -> None:
        """Remove a service location from cache."""
        logger.debug(f"remove_service: {name} from {location}")
        self.addresses.pop(location, None)
        if name in self.services:
            self.services[name] = [loc for loc in self.services[name] if loc != location]
            if not self.services[name]:
                del self.services[name]
    
    def add_subscription(self, channel: str, location: str) -> None:
        """Add a subscription location for a channel."""
        if channel not in self.subscriptions:
            self.subscriptions[channel] = []
        if location not in self.subscriptions[channel]:
            self.subscriptions[channel].append(location)
    
    def remove_subscription(self, channel: str, location: str) -> None:
        """Remove a subscription location from a channel."""
        if channel in self.subscriptions:
            self.subscriptions[channel] = [
                loc for loc in self.subscriptions[channel] if loc != location
            ]
            if not self.subscriptions[channel]:
                del self.subscriptions[channel]
    
    def get_location(self, service_name: str) -> Optional[str]:
        """
        Get a location for a service.
        
        Uses random selection for basic load balancing.
        Returns None if service not in cache.
        """
        locations = self.services.get(service_name, [])
        return random.choice(locations) if locations else None
    
    def has_service(self, service_name: str) -> bool:
        """Check if service exists in cache."""
        return service_name in self.services and len(self.services[service_name]) > 0
    
    def clear(self) -> None:
        """Clear all cached data."""
        self.services.clear()
        self.addresses.clear()
        self.subscriptions.clear()

