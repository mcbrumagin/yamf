"""
Publish Message Tests

Tests for the publish_message API function.
"""

import pytest
from yamf import (
    create_subscription_service,
    publish_message,
)


@pytest.mark.asyncio
async def test_publish_to_channel(registry, cleanup_services):
    """Test basic publish to a channel."""
    received = []
    
    service = await create_subscription_service({
        'publish-test': lambda msg: received.append(msg)
    })
    cleanup_services.append(service)
    
    result = await publish_message('publish-test', {'data': 'hello'})
    
    assert len(received) == 1
    assert received[0]['data'] == 'hello'
    assert 'results' in result


@pytest.mark.asyncio
async def test_publish_to_empty_channel(registry):
    """Test publishing to channel with no subscribers."""
    result = await publish_message('empty-channel', {'data': 'nobody home'})
    
    # Should complete without error
    assert result is not None


@pytest.mark.asyncio
async def test_publish_complex_message(registry, cleanup_services):
    """Test publishing complex message payloads."""
    received = []
    
    service = await create_subscription_service({
        'complex-msg': lambda msg: received.append(msg)
    })
    cleanup_services.append(service)
    
    complex_message = {
        'user': {'id': 123, 'name': 'Test User'},
        'action': 'created',
        'metadata': {
            'timestamp': 1234567890,
            'source': 'test',
            'tags': ['important', 'user-event']
        }
    }
    
    await publish_message('complex-msg', complex_message)
    
    assert len(received) == 1
    assert received[0]['user']['id'] == 123
    assert received[0]['metadata']['tags'] == ['important', 'user-event']


@pytest.mark.asyncio
async def test_publish_returns_aggregated_results(registry, cleanup_services):
    """Test that publish returns results from all handlers."""
    service = await create_subscription_service({
        'result-test': lambda msg: {'processed': msg['id'], 'status': 'ok'}
    })
    cleanup_services.append(service)
    
    result = await publish_message('result-test', {'id': 42})
    
    assert 'results' in result
    # Results structure depends on registry aggregation


@pytest.mark.asyncio
async def test_publish_multiple_subscribers(registry, cleanup_services):
    """Test publish reaches all subscribers."""
    received1 = []
    received2 = []
    received3 = []
    
    svc1 = await create_subscription_service({'multi-pub': lambda m: received1.append(m)})
    svc2 = await create_subscription_service({'multi-pub': lambda m: received2.append(m)})
    svc3 = await create_subscription_service({'multi-pub': lambda m: received3.append(m)})
    cleanup_services.extend([svc1, svc2, svc3])
    
    await publish_message('multi-pub', {'broadcast': True})
    
    assert len(received1) == 1
    assert len(received2) == 1
    assert len(received3) == 1


@pytest.mark.asyncio
async def test_publish_none_message(registry, cleanup_services):
    """Test publishing None as message."""
    received = []
    
    service = await create_subscription_service({
        'none-msg': lambda msg: received.append(msg)
    })
    cleanup_services.append(service)
    
    await publish_message('none-msg', None)
    
    assert len(received) == 1
    assert received[0] is None


@pytest.mark.asyncio
async def test_publish_string_message(registry, cleanup_services):
    """Test publishing plain string message."""
    received = []
    
    service = await create_subscription_service({
        'string-msg': lambda msg: received.append(msg)
    })
    cleanup_services.append(service)
    
    await publish_message('string-msg', 'plain string event')
    
    assert len(received) == 1
    assert received[0] == 'plain string event'


@pytest.mark.asyncio
async def test_publish_list_message(registry, cleanup_services):
    """Test publishing list as message."""
    received = []
    
    service = await create_subscription_service({
        'list-msg': lambda msg: received.append(msg)
    })
    cleanup_services.append(service)
    
    await publish_message('list-msg', [1, 2, 3, 'four'])
    
    assert len(received) == 1
    assert received[0] == [1, 2, 3, 'four']
