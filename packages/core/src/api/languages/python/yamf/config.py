"""
YAMF Configuration

Environment-based configuration with type coercion and validation.
"""

import os
import json
import logging
from typing import Any, Optional, TypeVar

logger = logging.getLogger('yamf.config')

T = TypeVar('T')


class EnvConfig:
    """Environment-based configuration manager."""
    
    def __init__(self):
        self._cache: dict[str, Any] = {}
        self._load_from_environment()
    
    def _load_from_environment(self) -> None:
        """Load and parse all environment variables."""
        for key, value in os.environ.items():
            self._cache[key] = self._parse_value(value)
    
    def _parse_value(self, value: str) -> Any:
        """Parse string value to appropriate Python type."""
        if not value:
            return value
        
        # Boolean
        if value.lower() == 'true':
            return True
        if value.lower() == 'false':
            return False
        
        # Integer
        if value.isdigit() or (value.startswith('-') and value[1:].isdigit()):
            return int(value)
        
        # Float
        try:
            return float(value)
        except ValueError:
            pass
        
        # JSON (arrays, objects)
        if (value.startswith('[') and value.endswith(']')) or \
           (value.startswith('{') and value.endswith('}')):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse JSON env var: {value[:50]}...")
        
        return value
    
    def get(self, key: str, default: T = None) -> T | Any:
        """Get config value with optional default."""
        return self._cache.get(key, default)
    
    def get_required(self, key: str) -> Any:
        """Get required config value, raise if missing."""
        if key not in self._cache:
            raise KeyError(f"Required environment variable '{key}' is not set")
        return self._cache[key]
    
    def set(self, key: str, value: Any) -> None:
        """Set config value (runtime only, doesn't modify env)."""
        self._cache[key] = value
    
    def has(self, key: str) -> bool:
        """Check if config key exists."""
        return key in self._cache
    
    def load_env_file(self, path: str = '.env') -> None:
        """Load additional config from .env file."""
        try:
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    
                    if '=' in line:
                        key, value = line.split('=', 1)
                        # Remove surrounding quotes
                        value = value.strip().strip('"').strip("'")
                        self._cache[key.strip()] = self._parse_value(value)
        except FileNotFoundError:
            logger.debug(f"Env file {path} not found, skipping")
        except Exception as e:
            logger.error(f"Error loading env file {path}: {e}")
    
    def validate_required(self, keys: list[str]) -> None:
        """Validate that all required keys are present."""
        missing = [key for key in keys if key not in self._cache]
        if missing:
            raise KeyError(f"Missing required environment variables: {', '.join(missing)}")


# Singleton instance
env_config = EnvConfig()

