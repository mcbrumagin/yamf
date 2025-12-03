"""
YAMF Error Classes

Exception hierarchy for yamf operations.
"""


class YamfError(Exception):
    """Base exception for yamf errors."""
    
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"{status_code}: {message}")


class HttpError(YamfError):
    """HTTP-level errors (4xx, 5xx responses)."""
    pass


class ConfigError(YamfError):
    """Configuration errors (missing env vars, invalid config)."""
    
    def __init__(self, message: str):
        super().__init__(500, message)


class ServiceNotFoundError(YamfError):
    """Service not found in cache or registry."""
    
    def __init__(self, service_name: str):
        super().__init__(404, f"Service '{service_name}' not found")
        self.service_name = service_name


class RegistrationError(YamfError):
    """Service registration failed."""
    
    def __init__(self, service_name: str, message: str):
        super().__init__(500, f"Failed to register service '{service_name}': {message}")
        self.service_name = service_name

