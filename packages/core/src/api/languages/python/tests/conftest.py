"""
Pytest Configuration and Fixtures

Provides fixtures for registry setup and service cleanup.
Tests assume a registry server is running at YAMF_REGISTRY_URL.
"""

import os
import pytest
import pytest_asyncio
import asyncio
import subprocess
import time
import signal
from typing import List, Any

# Set default registry URL if not set
if 'YAMF_REGISTRY_URL' not in os.environ:
    os.environ['YAMF_REGISTRY_URL'] = 'http://localhost:3000'


@pytest.fixture(scope="session")
def event_loop():
    """Create a session-scoped event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="module")
async def registry():
    """
    Registry fixture - starts registry server for test module.
    
    The registry is started as a subprocess and terminated after tests.
    Alternatively, set YAMF_REGISTRY_EXTERNAL=1 to use an external registry.
    """
    if os.environ.get('YAMF_REGISTRY_EXTERNAL'):
        # Use externally managed registry
        yield os.environ['YAMF_REGISTRY_URL']
        return
    
    # Start registry subprocess
    registry_url = os.environ['YAMF_REGISTRY_URL']
    port = registry_url.split(':')[-1]
    
    # Path to registry start script (adjust as needed)
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    )))
    
    registry_process = None
    try:
        # Try to start registry via node
        registry_process = subprocess.Popen(
            ['node', '-e', f'''
                const {{ registryServer }} = require("{project_root}/src/index.js");
                registryServer({{ port: {port} }});
            '''],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=os.setsid if hasattr(os, 'setsid') else None
        )
        
        # Wait for registry to be ready
        await asyncio.sleep(0.5)
        
        yield registry_url
        
    finally:
        if registry_process:
            # Terminate registry process group
            try:
                if hasattr(os, 'killpg'):
                    os.killpg(os.getpgid(registry_process.pid), signal.SIGTERM)
                else:
                    registry_process.terminate()
                registry_process.wait(timeout=5)
            except Exception:
                registry_process.kill()


@pytest_asyncio.fixture
async def cleanup_services():
    """
    Fixture to track and cleanup services after each test.
    
    Usage:
        async def test_something(cleanup_services):
            service = await create_service('test', handler)
            cleanup_services.append(service)
            # ... test code ...
        # Services automatically terminated after test
    """
    services: List[Any] = []
    yield services
    
    # Cleanup all tracked services
    for service in services:
        try:
            await service.terminate()
        except Exception as e:
            # Log but don't fail on cleanup errors
            print(f"Cleanup warning: {e}")


@pytest.fixture(autouse=True)
def reset_environment():
    """Reset environment state before each test."""
    # Ensure registry URL is set
    if 'YAMF_REGISTRY_URL' not in os.environ:
        os.environ['YAMF_REGISTRY_URL'] = 'http://localhost:4000'
    
    yield
    
    # Any post-test cleanup can go here


# Markers for test categorization
def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )
