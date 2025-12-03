"""
Call Service Tests

Tests for calling services via registry and cache.
"""

import pytest
from yamf import (
    create_service,
    call_service,
    ServiceNotFoundError,
    YamfError,
)
from yamf.api.call_service import call_service_with_cache
from yamf.service import ServiceState


@pytest.mark.asyncio
async def test_call_through_registry(registry, cleanup_services):
    """Test basic call routed through registry."""
    service = await create_service('registry_call', lambda self, p: {'via': 'registry'})
    cleanup_services.append(service)
    
    result = await call_service('registry_call', {'test': True})
    
    assert result['via'] == 'registry'


@pytest.mark.asyncio
async def test_call_with_cache_direct(registry, cleanup_services):
    """Test direct call using cached location."""
    service = await create_service('cache_call', lambda self, p: {'via': 'cache'})
    cleanup_services.append(service)
    
    # Use the service's internal cache which has the location
    result = await call_service_with_cache(service.cache, 'cache_call', {'test': True})
    
    assert result['via'] == 'cache'


@pytest.mark.asyncio
async def test_call_with_cache_not_found(registry):
    """Test error when service not in cache."""
    empty_cache = ServiceState()
    
    with pytest.raises(ServiceNotFoundError) as exc_info:
        await call_service_with_cache(empty_cache, 'not_in_cache', {})
    
    assert 'not_in_cache' in str(exc_info.value)


@pytest.mark.asyncio
async def test_call_nonexistent_service(registry):
    """Test proper error for missing service."""
    with pytest.raises((ServiceNotFoundError, YamfError)) as exc_info:
        await call_service('definitely_not_a_service', {'data': 'test'})
    
    error_msg = str(exc_info.value).lower()
    assert 'not found' in error_msg or '404' in error_msg or 'no service' in error_msg


@pytest.mark.asyncio
async def test_call_with_payload(registry, cleanup_services):
    """Test payload is passed correctly."""
    async def echo_service(self, payload):
        return {
            'received': payload,
            'type': type(payload).__name__
        }
    
    service = await create_service('payload_test', echo_service)
    cleanup_services.append(service)
    
    # Dict payload
    result = await call_service('payload_test', {'key': 'value', 'num': 42})
    assert result['received']['key'] == 'value'
    assert result['received']['num'] == 42
    
    # List payload
    result = await call_service('payload_test', [1, 2, 3])
    assert result['received'] == [1, 2, 3]
    
    # String payload
    result = await call_service('payload_test', 'hello')
    assert result['received'] == 'hello'


@pytest.mark.asyncio
async def test_call_with_none_payload(registry, cleanup_services):
    """Test calling with None/empty payload."""
    service = await create_service('none_payload', lambda self, p: {'payload': p})
    cleanup_services.append(service)
    
    result = await call_service('none_payload', None)
    assert result['payload'] is None
    
    result = await call_service('none_payload')
    assert result['payload'] is None


@pytest.mark.asyncio
async def test_call_complex_nested_payload(registry, cleanup_services):
    """Test complex nested payload structures."""
    async def echo(self, payload):
        return payload
    
    service = await create_service('complex_payload', echo)
    cleanup_services.append(service)
    
    complex_payload = {
        'nested': {
            'deeply': {
                'nested': {
                    'value': 123
                }
            }
        },
        'array': [1, 2, {'inner': 'value'}],
        'mixed': {
            'items': [
                {'id': 1, 'name': 'first'},
                {'id': 2, 'name': 'second'}
            ]
        },
        'types': {
            'string': 'hello',
            'number': 42,
            'float': 3.14,
            'boolean': True,
            'null': None
        }
    }
    
    result = await call_service('complex_payload', complex_payload)
    
    assert result['nested']['deeply']['nested']['value'] == 123
    assert result['array'][2]['inner'] == 'value'
    assert result['mixed']['items'][1]['name'] == 'second'
    assert result['types']['boolean'] is True
    assert result['types']['null'] is None


@pytest.mark.asyncio
async def test_dynamic_service_stubs(registry, cleanup_services):
    """Test dynamic service stubs via __getattr__."""
    async def helper_service(self, payload):
        return f"helper: {payload}"
    
    async def main_service(self, payload):
        # Use dynamic stub instead of self.call()
        result = await self.stub_helper(payload)
        return f"main called -> {result}"
    
    svc_helper = await create_service('stub_helper', helper_service)
    svc_main = await create_service('stub_main', main_service)
    cleanup_services.extend([svc_helper, svc_main])
    
    result = await call_service('stub_main', 'test_data')
    
    assert 'helper: test_data' in result
    assert 'main called' in result


@pytest.mark.asyncio
async def test_call_returns_string(registry, cleanup_services):
    """Test service returning plain string."""
    service = await create_service('string_return', lambda self, p: 'plain string result')
    cleanup_services.append(service)
    
    result = await call_service('string_return', {})
    
    assert result == 'plain string result'


@pytest.mark.asyncio
async def test_call_returns_number(registry, cleanup_services):
    """Test service returning number."""
    service = await create_service('number_return', lambda self, p: 42)
    cleanup_services.append(service)
    
    result = await call_service('number_return', {})
    
    assert result == 42


@pytest.mark.asyncio
async def test_call_returns_list(registry, cleanup_services):
    """Test service returning list."""
    service = await create_service('list_return', lambda self, p: [1, 2, 3, 'four'])
    cleanup_services.append(service)
    
    result = await call_service('list_return', {})
    
    assert result == [1, 2, 3, 'four']


@pytest.mark.asyncio
async def test_call_returns_boolean(registry, cleanup_services):
    """Test service returning boolean."""
    svc_true = await create_service('bool_true', lambda self, p: True)
    svc_false = await create_service('bool_false', lambda self, p: False)
    cleanup_services.extend([svc_true, svc_false])
    
    assert await call_service('bool_true', {}) is True
    assert await call_service('bool_false', {}) is False


@pytest.mark.asyncio  
async def test_service_context_has_cache(registry, cleanup_services):
    """Test that service context provides access to cache."""
    async def inspect_context(self, payload):
        return {
            'has_cache': hasattr(self, 'cache') or hasattr(self, '_state'),
            'can_call': hasattr(self, 'call'),
            'can_publish': hasattr(self, 'publish'),
        }
    
    service = await create_service('context_inspect', inspect_context)
    cleanup_services.append(service)
    
    result = await call_service('context_inspect', {})
    
    assert result['can_call'] is True
    assert result['can_publish'] is True
