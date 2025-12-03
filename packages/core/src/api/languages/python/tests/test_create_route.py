"""
Create Route Tests

Tests for URL route creation and mapping to services.
"""

import pytest
import aiohttp
import os
from yamf import (
    create_route,
    create_service,
    YamfService,
    YamfError,
)


async def fetch(url: str, method: str = 'GET', body=None, headers=None):
    """Helper to make HTTP requests."""
    async with aiohttp.ClientSession() as session:
        kwargs = {'headers': headers or {}}
        if body is not None:
            import json
            kwargs['data'] = json.dumps(body)
            kwargs['headers']['Content-Type'] = 'application/json'
        
        async with session.request(method, url, **kwargs) as response:
            text = await response.text()
            try:
                import json
                return json.loads(text), response.status
            except:
                return text, response.status


@pytest.mark.asyncio
async def test_basic_route(registry, cleanup_services):
    """Test basic route creation with inline handler."""
    async def hello_handler(self, payload):
        return {'message': 'Hello World!'}
    
    service = await create_route('/hello', hello_handler)
    cleanup_services.append(service)
    
    assert isinstance(service, YamfService)
    
    # Call via direct HTTP to route
    registry_url = os.environ['YAMF_REGISTRY_URL']
    result, status = await fetch(f"{registry_url}/hello")
    
    assert status == 200
    assert result['message'] == 'Hello World!'


@pytest.mark.asyncio
async def test_route_with_existing_service(registry, cleanup_services):
    """Test route pointing to existing service by name."""
    async def greeting_service(self, payload):
        name = payload.get('name', 'World') if payload else 'World'
        return f"Hello {name}!"
    
    service = await create_service('greeting_service', greeting_service)
    cleanup_services.append(service)
    
    # Create route pointing to service name
    route_service = await create_route('/greet', 'greeting_service')
    # route_service is None when using service name
    
    # Call via route
    registry_url = os.environ['YAMF_REGISTRY_URL']
    result, status = await fetch(f"{registry_url}/greet")
    
    assert status == 200
    assert 'Hello World!' in result


@pytest.mark.asyncio
async def test_route_with_payload(registry, cleanup_services):
    """Test route passing POST payload to service."""
    async def user_service(self, payload):
        return {
            'id': 123,
            'name': payload.get('name'),
            'email': payload.get('email'),
            'created': True
        }
    
    service = await create_route('/users', user_service)
    cleanup_services.append(service)
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    result, status = await fetch(
        f"{registry_url}/users",
        method='POST',
        body={'name': 'John Doe', 'email': 'john@example.com'}
    )
    
    assert status == 200
    assert result['name'] == 'John Doe'
    assert result['email'] == 'john@example.com'
    assert result['created'] is True


@pytest.mark.asyncio
async def test_route_wildcard(registry, cleanup_services):
    """Test wildcard route matching."""
    async def api_controller(self, payload, request=None):
        # In Python we might not have request object directly
        return {'path': '/api/test', 'message': 'API response'}
    
    service = await create_route('/api/*', api_controller)
    cleanup_services.append(service)
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    result, status = await fetch(f"{registry_url}/api/users")
    
    assert status == 200
    assert result['message'] == 'API response'


@pytest.mark.asyncio
async def test_route_missing_service(registry, cleanup_services):
    """Test route to non-existent service returns error."""
    # Create route to service that doesn't exist
    await create_route('/broken', 'nonExistentService')
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    result, status = await fetch(f"{registry_url}/broken")
    
    # Should be an error status
    assert status >= 400


@pytest.mark.asyncio
async def test_route_validation_empty_path(registry):
    """Test error when route path is empty."""
    with pytest.raises((ValueError, YamfError)):
        await create_route('', lambda self, p: p)


@pytest.mark.asyncio
async def test_route_validation_empty_service(registry):
    """Test error when service is empty string."""
    with pytest.raises((ValueError, YamfError)):
        await create_route('/test', '')


@pytest.mark.asyncio
async def test_route_returns_json(registry, cleanup_services):
    """Test route returning JSON object."""
    service = await create_route('/json', lambda self, p: {'type': 'json', 'data': [1, 2, 3]})
    cleanup_services.append(service)
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    result, status = await fetch(f"{registry_url}/json")
    
    assert status == 200
    assert result['type'] == 'json'
    assert result['data'] == [1, 2, 3]


@pytest.mark.asyncio
async def test_route_returns_string(registry, cleanup_services):
    """Test route returning plain string."""
    service = await create_route('/text', lambda self, p: 'plain text response')
    cleanup_services.append(service)
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    result, status = await fetch(f"{registry_url}/text")
    
    assert status == 200
    assert 'plain text response' in str(result)


@pytest.mark.asyncio
async def test_multiple_routes_same_service(registry, cleanup_services):
    """Test multiple routes pointing to same service."""
    service = await create_service('multi_route_svc', lambda self, p: {'service': 'multi'})
    cleanup_services.append(service)
    
    await create_route('/route1', 'multi_route_svc')
    await create_route('/route2', 'multi_route_svc')
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    
    result1, _ = await fetch(f"{registry_url}/route1")
    result2, _ = await fetch(f"{registry_url}/route2")
    
    assert result1['service'] == 'multi'
    assert result2['service'] == 'multi'
