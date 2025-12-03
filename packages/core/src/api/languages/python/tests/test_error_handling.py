"""
Error Handling Tests

Tests for error propagation, validation, and HTTP error status codes.
"""

import pytest
import aiohttp
import os
from yamf import (
    create_service,
    create_route,
    call_service,
    YamfError,
    HttpError,
    ServiceNotFoundError,
    RegistrationError,
)


@pytest.mark.asyncio
async def test_service_empty_name(registry):
    """Test creating service with empty name raises error."""
    with pytest.raises(ValueError) as exc_info:
        await create_service('', lambda self, p: p)
    
    assert 'name' in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_service_name_with_spaces(registry):
    """Test creating service with spaces in name raises error."""
    with pytest.raises(ValueError) as exc_info:
        await create_service('invalid service name', lambda self, p: p)
    
    assert 'space' in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_call_nonexistent_service(registry):
    """Test calling non-existent service returns proper error."""
    with pytest.raises((ServiceNotFoundError, YamfError)) as exc_info:
        await call_service('doesNotExist', {'data': 'test'})
    
    error_str = str(exc_info.value).lower()
    assert 'doesnotexist' in error_str or 'not found' in error_str or '404' in error_str


@pytest.mark.asyncio
async def test_error_propagation_through_chain(registry, cleanup_services):
    """Test error propagation through service chain."""
    async def error_service(self, payload):
        raise HttpError(418, "I'm a teapot")
    
    async def caller_service(self, payload):
        return await self.call('teapot_service', payload)
    
    svc_error = await create_service('teapot_service', error_service)
    svc_caller = await create_service('teapot_caller', caller_service)
    cleanup_services.extend([svc_error, svc_caller])
    
    with pytest.raises((HttpError, YamfError)) as exc_info:
        await call_service('teapot_caller', {})
    
    error_str = str(exc_info.value).lower()
    assert '418' in error_str or 'teapot' in error_str


@pytest.mark.asyncio
async def test_service_throws_exception(registry, cleanup_services):
    """Test that service exceptions become HTTP errors."""
    async def throwing_service(self, payload):
        raise ValueError("Something went wrong internally")
    
    service = await create_service('throwing', throwing_service)
    cleanup_services.append(service)
    
    with pytest.raises((YamfError, HttpError, Exception)) as exc_info:
        await call_service('throwing', {})
    
    # Should be some kind of error response
    assert exc_info.value is not None


async def fetch_status(url: str, method: str = 'GET', body=None):
    """Helper to get HTTP status code."""
    async with aiohttp.ClientSession() as session:
        kwargs = {}
        if body:
            import json
            kwargs['data'] = json.dumps(body)
            kwargs['headers'] = {'Content-Type': 'application/json'}
        async with session.request(method, url, **kwargs) as response:
            return response.status, await response.text()


@pytest.mark.asyncio
async def test_route_404_error(registry, cleanup_services):
    """Test 404 error from service via route."""
    async def not_found_service(self, payload):
        raise HttpError(404, 'Resource not found')
    
    service = await create_route('/not-found-test', not_found_service)
    cleanup_services.append(service)
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    status, text = await fetch_status(f"{registry_url}/not-found-test")
    
    assert status == 404
    assert 'not found' in text.lower()


@pytest.mark.asyncio
async def test_route_500_error(registry, cleanup_services):
    """Test 500 error from unhandled exception."""
    async def crashing_service(self, payload):
        raise RuntimeError('Internal server error')
    
    service = await create_route('/crash-test', crashing_service)
    cleanup_services.append(service)
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    status, text = await fetch_status(f"{registry_url}/crash-test")
    
    assert status == 500


@pytest.mark.asyncio
async def test_route_400_error(registry, cleanup_services):
    """Test 400 bad request error."""
    async def validation_service(self, payload):
        if not payload or not payload.get('required'):
            raise HttpError(400, 'Missing required field')
        return {'ok': True}
    
    service = await create_route('/validate-test', validation_service)
    cleanup_services.append(service)
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    status, text = await fetch_status(
        f"{registry_url}/validate-test",
        method='POST',
        body={}
    )
    
    assert status == 400


@pytest.mark.asyncio
async def test_custom_error_status_codes(registry, cleanup_services):
    """Test various custom HTTP error status codes."""
    # services = [
    #     await create_route('/err-403', lambda self, p: (_ for _ in ()).throw(HttpError(403, 'Forbidden'))),
    #     await create_route('/err-409', lambda self, p: (_ for _ in ()).throw(HttpError(409, 'Conflict'))),
    #     await create_route('/err-422', lambda self, p: (_ for _ in ()).throw(HttpError(422, 'Unprocessable'))),
    # ]
    # Note: The lambda trick above won't work, need actual functions
    
    async def forbidden(self, p):
        raise HttpError(403, 'Forbidden')
    
    async def conflict(self, p):
        raise HttpError(409, 'Conflict')
    
    async def unprocessable(self, p):
        raise HttpError(422, 'Unprocessable')
    
    svc403 = await create_route('/err-403', forbidden)
    svc409 = await create_route('/err-409', conflict)
    svc422 = await create_route('/err-422', unprocessable)
    cleanup_services.extend([svc403, svc409, svc422])
    
    registry_url = os.environ['YAMF_REGISTRY_URL']
    
    status403, _ = await fetch_status(f"{registry_url}/err-403")
    status409, _ = await fetch_status(f"{registry_url}/err-409")
    status422, _ = await fetch_status(f"{registry_url}/err-422")
    
    assert status403 == 403
    assert status409 == 409
    assert status422 == 422


@pytest.mark.asyncio
async def test_registry_connection_failure():
    """Test error when registry is unreachable."""
    import os
    
    # Save original URL
    original_url = os.environ.get('YAMF_REGISTRY_URL')
    
    try:
        # Point to non-existent registry
        os.environ['YAMF_REGISTRY_URL'] = 'http://localhost:59999'
        
        # Clear cached config
        from yamf.config import env_config
        env_config._cache['YAMF_REGISTRY_URL'] = 'http://localhost:59999'
        
        with pytest.raises((RegistrationError, Exception)):
            await create_service('unreachable_test', lambda self, p: p)
    
    finally:
        # Restore original URL
        if original_url:
            os.environ['YAMF_REGISTRY_URL'] = original_url
            env_config._cache['YAMF_REGISTRY_URL'] = original_url


@pytest.mark.asyncio
async def test_service_url_like_name(registry):
    """Test that URL-like service names are handled properly."""
    # Service names starting with / should either work or fail gracefully
    with pytest.raises((ServiceNotFoundError, YamfError, ValueError)):
        await call_service('/health', {})


@pytest.mark.asyncio
async def test_dependent_service_throws_error(registry, cleanup_services):
    """Test error in dependent service bubbles up with context."""
    async def failing_dep(self, payload):
        raise ValueError("Error from failing_dep service")
    
    async def caller(self, payload):
        return await self.call('failing_dep', payload)
    
    svc_dep = await create_service('failing_dep', failing_dep)
    svc_caller = await create_service('error_caller', caller)
    cleanup_services.extend([svc_dep, svc_caller])
    
    with pytest.raises((YamfError, HttpError, Exception)) as exc_info:
        await call_service('error_caller', {'test': 'data'})
    
    # Error should contain some indication of the failure
    assert exc_info.value is not None


@pytest.mark.asyncio
async def test_registry_stays_healthy_after_errors(registry, cleanup_services):
    """Test registry continues working after service errors."""
    # Create a working service
    service = await create_service('healthy_svc', lambda self, p: {'status': 'ok'})
    cleanup_services.append(service)
    
    # Try to call non-existent service (should fail)
    try:
        await call_service('does_not_exist', {})
    except Exception:
        pass  # Expected
    
    # Working service should still work
    result = await call_service('healthy_svc', {})
    assert result['status'] == 'ok'
    
    # Try another bad call
    try:
        await call_service('another_missing', {})
    except Exception:
        pass  # Expected
    
    # Still working
    result = await call_service('healthy_svc', {})
    assert result['status'] == 'ok'

