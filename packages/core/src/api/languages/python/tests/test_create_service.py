"""
Create Service Tests

Tests for creating and registering RPC services.
"""

import pytest
from yamf import (
    create_service,
    call_service,
    YamfService,
    YamfError,
    ServiceNotFoundError,
)


@pytest.mark.asyncio
async def test_create_service_basic(registry, cleanup_services):
    """Test basic service creation and calling."""
    async def test_service(self, payload):
        payload['added'] = 'from_service'
        return payload
    
    service = await create_service('test_basic', test_service)
    cleanup_services.append(service)
    
    assert isinstance(service, YamfService)
    assert service.name == 'test_basic'
    assert service.location.startswith('http://')
    
    result = await call_service('test_basic', {'input': 'value'})
    
    assert result['input'] == 'value'
    assert result['added'] == 'from_service'


@pytest.mark.asyncio
async def test_create_service_with_named_function(registry, cleanup_services):
    """Test service creation using function name."""
    async def my_named_service(self, payload):
        return {'service': 'my_named_service', 'payload': payload}
    
    service = await create_service(my_named_service)
    cleanup_services.append(service)
    
    assert service.name == 'my_named_service'
    
    result = await call_service('my_named_service', {'test': 123})
    
    assert result['service'] == 'my_named_service'
    assert result['payload']['test'] == 123


@pytest.mark.asyncio
async def test_call_service_basic(registry, cleanup_services):
    """Test basic service call through registry."""
    service = await create_service('call_test', lambda self, p: 'TEST_RESULT')
    cleanup_services.append(service)
    
    result = await call_service('call_test', {})
    
    assert result == 'TEST_RESULT'


@pytest.mark.asyncio
async def test_dependent_service_context_call(registry, cleanup_services):
    """Test service calling another service via self.call()."""
    async def service_a(self, payload):
        return {**payload, 'a': 'called_a'}
    
    async def service_b(self, payload):
        result = await self.call('dep_service_a', payload)
        return {**result, 'b': 'called_b'}
    
    svc_a = await create_service('dep_service_a', service_a)
    svc_b = await create_service('dep_service_b', service_b)
    cleanup_services.extend([svc_a, svc_b])
    
    result = await call_service('dep_service_b', {'input': 'test'})
    
    assert result['input'] == 'test'
    assert result['a'] == 'called_a'
    assert result['b'] == 'called_b'


@pytest.mark.asyncio
async def test_service_chain(registry, cleanup_services):
    """Test chain of service calls: A -> B -> C -> D."""
    async def svc_d(self, payload):
        return f"|D| {payload}"
    
    async def svc_c(self, payload):
        result = await self.call('chain_d', f"C({payload})")
        return f"{result} -> C"
    
    async def svc_b(self, payload):
        result = await self.call('chain_c', f"B({payload})")
        return f"{result} -> B"
    
    async def svc_a(self, payload):
        result = await self.call('chain_b', f"A({payload})")
        return f"{result} -> A"
    
    services = [
        await create_service('chain_d', svc_d),
        await create_service('chain_c', svc_c),
        await create_service('chain_b', svc_b),
        await create_service('chain_a', svc_a),
    ]
    cleanup_services.extend(services)
    
    result = await call_service('chain_a', 'START')
    
    assert '|D|' in result
    assert 'A(START)' in result
    assert '-> C' in result
    assert '-> B' in result
    assert '-> A' in result


@pytest.mark.asyncio
async def test_missing_service_error(registry):
    """Test error when calling non-existent service."""
    with pytest.raises((ServiceNotFoundError, YamfError)) as exc_info:
        await call_service('does_not_exist', {})
    
    assert 'does_not_exist' in str(exc_info.value).lower() or '404' in str(exc_info.value)


@pytest.mark.asyncio
async def test_missing_dependent_service(registry, cleanup_services):
    """Test error when self.call() targets non-existent service."""
    async def caller_service(self, payload):
        return await self.call('nonexistent_dep', payload)
    
    service = await create_service('caller_with_missing_dep', caller_service)
    cleanup_services.append(service)
    
    with pytest.raises((ServiceNotFoundError, YamfError)):
        await call_service('caller_with_missing_dep', {'test': 'data'})


@pytest.mark.asyncio
async def test_service_dynamic_ports(registry, cleanup_services):
    """Test that multiple services get unique ports."""
    svc1 = await create_service('port_test_1', lambda self, p: 'svc1')
    svc2 = await create_service('port_test_2', lambda self, p: 'svc2')
    svc3 = await create_service('port_test_3', lambda self, p: 'svc3')
    cleanup_services.extend([svc1, svc2, svc3])
    
    # All should have unique locations
    locations = {svc1.location, svc2.location, svc3.location}
    assert len(locations) == 3
    
    # All should be callable
    assert await call_service('port_test_1', {}) == 'svc1'
    assert await call_service('port_test_2', {}) == 'svc2'
    assert await call_service('port_test_3', {}) == 'svc3'


@pytest.mark.asyncio
async def test_anonymous_function_service(registry, cleanup_services):
    """Test lambda/unnamed functions get generated names."""
    service = await create_service(lambda self, p: {'anonymous': True, **p})
    cleanup_services.append(service)
    
    assert 'Anon_' in service.name
    
    result = await call_service(service.name, {'input': 'test'})
    
    assert result['anonymous'] is True
    assert result['input'] == 'test'


@pytest.mark.asyncio
async def test_multiple_anonymous_services(registry, cleanup_services):
    """Test multiple anonymous services get unique names."""
    svc1 = await create_service(lambda self, p: {'svc': 1})
    svc2 = await create_service(lambda self, p: {'svc': 2})
    svc3 = await create_service(lambda self, p: {'svc': 3})
    cleanup_services.extend([svc1, svc2, svc3])
    
    # All should have unique Anon_ names
    assert all('Anon_' in s.name for s in [svc1, svc2, svc3])
    assert len({svc1.name, svc2.name, svc3.name}) == 3


@pytest.mark.asyncio
async def test_service_context_manager(registry):
    """Test automatic cleanup with async context manager."""
    async with await create_service('ctx_test', lambda self, p: p) as service:
        assert service.name == 'ctx_test'
        result = await call_service('ctx_test', {'data': 42})
        assert result['data'] == 42
    
    # After context exit, service should be unregistered
    with pytest.raises((ServiceNotFoundError, YamfError)):
        await call_service('ctx_test', {})


@pytest.mark.asyncio
async def test_service_terminate(registry):
    """Test manual service termination."""
    service = await create_service('terminate_test', lambda self, p: 'alive')
    
    # Service should work
    assert await call_service('terminate_test', {}) == 'alive'
    
    # Terminate
    await service.terminate()
    
    # Should be gone
    with pytest.raises((ServiceNotFoundError, YamfError)):
        await call_service('terminate_test', {})


@pytest.mark.asyncio
async def test_service_name_validation_empty(registry):
    """Test that empty service name raises error."""
    with pytest.raises(ValueError) as exc_info:
        await create_service('', lambda self, p: p)
    
    assert 'name' in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_service_name_validation_spaces(registry):
    """Test that service name with spaces raises error."""
    with pytest.raises(ValueError) as exc_info:
        await create_service('invalid service name', lambda self, p: p)
    
    assert 'space' in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_service_with_special_characters(registry, cleanup_services):
    """Test service names with dashes and underscores work."""
    svc1 = await create_service('test-with-dashes', lambda self, p: 'dashes')
    svc2 = await create_service('test_with_underscores', lambda self, p: 'underscores')
    cleanup_services.extend([svc1, svc2])
    
    assert await call_service('test-with-dashes', {}) == 'dashes'
    assert await call_service('test_with_underscores', {}) == 'underscores'


@pytest.mark.asyncio
async def test_large_payload(registry, cleanup_services):
    """Test handling of large payloads."""
    async def echo_service(self, payload):
        return {
            'received_length': len(payload.get('data', '')),
            'preview': payload.get('data', '')[:20]
        }
    
    service = await create_service('large_payload', echo_service)
    cleanup_services.append(service)
    
    large_data = 'x' * 10000  # 10KB
    result = await call_service('large_payload', {'data': large_data})
    
    assert result['received_length'] == 10000
    assert result['preview'] == 'x' * 20


@pytest.mark.asyncio
async def test_service_before_handler(registry, cleanup_services):
    """Test service.before() preprocessing handler."""
    async def main_handler(self, payload):
        payload['main'] = True
        return payload
    
    service = await create_service('before_test', main_handler)
    cleanup_services.append(service)
    
    async def before_handler(payload, request):
        payload['before'] = True
        payload['timestamp'] = 12345
        return payload
    
    service.before(before_handler)
    
    result = await call_service('before_test', {'input': 'test'})
    
    assert result['input'] == 'test'
    assert result['before'] is True
    assert result['main'] is True
    assert result['timestamp'] == 12345
