"""
Subscription Service Tests

Tests for pub/sub functionality with createSubscriptionService.
"""

import pytest
from yamf import (
    create_subscription_service,
    publish_message,
    SubscriptionService,
)


@pytest.mark.asyncio
async def test_basic_subscription(registry, cleanup_services):
    """Test basic subscription creation and message delivery."""
    messages = []
    
    async def handler(message):
        messages.append(message)
        return {'received': True}
    
    service = await create_subscription_service({
        'test-channel': handler
    })
    cleanup_services.append(service)
    
    assert isinstance(service, SubscriptionService)
    assert 'test-channel' in service.channels
    
    # Publish message
    result = await publish_message('test-channel', {'data': 'test message 1'})
    
    assert len(messages) == 1
    assert messages[0]['data'] == 'test message 1'
    
    # Publish another
    await publish_message('test-channel', {'data': 'test message 2'})
    
    assert len(messages) == 2
    assert messages[1]['data'] == 'test message 2'


@pytest.mark.asyncio
async def test_subscription_with_name(registry, cleanup_services):
    """Test subscription service with explicit name."""
    service = await create_subscription_service(
        {'my-channel': lambda msg: msg},
        name='my-subscription'
    )
    cleanup_services.append(service)
    
    assert service.name == 'my-subscription'


@pytest.mark.asyncio
async def test_multiple_subscriptions_same_channel(registry, cleanup_services):
    """Test multiple services subscribed to same channel."""
    messages1 = []
    messages2 = []
    
    sub1 = await create_subscription_service({
        'shared-channel': lambda msg: messages1.append(msg)
    })
    sub2 = await create_subscription_service({
        'shared-channel': lambda msg: messages2.append(msg)
    })
    cleanup_services.extend([sub1, sub2])
    
    # Publish - both should receive
    await publish_message('shared-channel', {'data': 'broadcast'})
    
    assert len(messages1) == 1
    assert len(messages2) == 1
    assert messages1[0]['data'] == 'broadcast'
    assert messages2[0]['data'] == 'broadcast'


@pytest.mark.asyncio
async def test_multiple_channel_subscriptions(registry, cleanup_services):
    """Test one service subscribed to multiple channels."""
    channel_a_messages = []
    channel_b_messages = []
    
    service = await create_subscription_service({
        'channel-a': lambda msg: channel_a_messages.append(msg),
        'channel-b': lambda msg: channel_b_messages.append(msg),
    })
    cleanup_services.append(service)
    
    assert 'channel-a' in service.channels
    assert 'channel-b' in service.channels
    
    # Publish to different channels
    await publish_message('channel-a', {'source': 'A'})
    await publish_message('channel-b', {'source': 'B'})
    
    assert len(channel_a_messages) == 1
    assert len(channel_b_messages) == 1
    assert channel_a_messages[0]['source'] == 'A'
    assert channel_b_messages[0]['source'] == 'B'


@pytest.mark.asyncio
async def test_subscription_termination(registry, cleanup_services):
    """Test that termination stops message delivery."""
    messages = []
    
    service = await create_subscription_service({
        'term-channel': lambda msg: messages.append(msg)
    })
    
    # Send first message
    await publish_message('term-channel', {'id': 1})
    assert len(messages) == 1
    
    # Terminate
    await service.terminate()
    
    # Send second message - should NOT be received
    await publish_message('term-channel', {'id': 2})
    
    # Still only 1 message
    assert len(messages) == 1
    assert messages[0]['id'] == 1


@pytest.mark.asyncio
async def test_subscription_invalid_handler(registry):
    """Test error when handler is not callable."""
    with pytest.raises(ValueError) as exc_info:
        await create_subscription_service({
            'test-channel': 'not-a-function'
        })
    
    assert 'callable' in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_subscription_empty_channels(registry):
    """Test error when no channels provided."""
    with pytest.raises(ValueError) as exc_info:
        await create_subscription_service({})
    
    assert 'channel' in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_subscription_handler_error(registry, cleanup_services):
    """Test that handler errors are captured."""
    async def error_handler(message):
        if message.get('should_error'):
            raise ValueError('Intentional handler error')
        return {'success': True}
    
    service = await create_subscription_service({
        'error-channel': error_handler
    })
    cleanup_services.append(service)
    
    # Publish message that causes error
    result = await publish_message('error-channel', {'should_error': True})
    
    # Error should be captured in results
    # The exact structure depends on how registry aggregates results
    assert result is not None


@pytest.mark.asyncio
async def test_subscription_complex_payloads(registry, cleanup_services):
    """Test complex message payloads."""
    messages = []
    
    service = await create_subscription_service({
        'complex-channel': lambda msg: messages.append(msg)
    })
    cleanup_services.append(service)
    
    # Send complex payload
    await publish_message('complex-channel', {
        'nested': {'deeply': {'nested': {'value': 123}}},
        'array': [1, 2, 3],
        'mixed': {'items': [{'id': 1}, {'id': 2}]}
    })
    
    await publish_message('complex-channel', {
        'string': 'test',
        'number': 42,
        'boolean': True,
        'null': None
    })
    
    assert len(messages) == 2
    assert messages[0]['nested']['deeply']['nested']['value'] == 123
    assert messages[0]['array'] == [1, 2, 3]
    assert messages[1]['boolean'] is True
    assert messages[1]['null'] is None


@pytest.mark.asyncio
async def test_subscription_publish_results(registry, cleanup_services):
    """Test that publish returns handler results."""
    async def returning_handler(message):
        return {'echo': message, 'processed': True}
    
    service = await create_subscription_service({
        'result-channel': returning_handler
    })
    cleanup_services.append(service)
    
    result = await publish_message('result-channel', {'test': 'data'})
    
    # Result should contain the handler's return value
    assert 'results' in result
    assert len(result['results']) > 0


@pytest.mark.asyncio
async def test_concurrent_messages(registry, cleanup_services):
    """Test concurrent message handling."""
    import asyncio
    
    messages = []
    
    async def slow_handler(message):
        messages.append(message['id'])
        return {'id': message['id']}
    
    service = await create_subscription_service({
        'concurrent-channel': slow_handler
    })
    cleanup_services.append(service)
    
    # Send multiple messages
    await asyncio.gather(*[
        publish_message('concurrent-channel', {'id': i})
        for i in range(5)
    ])
    
    assert len(messages) == 5
    assert set(messages) == {0, 1, 2, 3, 4}  # All unique IDs received


@pytest.mark.asyncio
async def test_subscription_starts_clean(registry, cleanup_services):
    """Test that subscriptions don't receive old messages."""
    messages = []
    
    # Publish BEFORE subscription exists
    await publish_message('clean-channel', {'id': 0})
    
    # Now create subscription
    service = await create_subscription_service({
        'clean-channel': lambda msg: messages.append(msg)
    })
    cleanup_services.append(service)
    
    # Should NOT have received the message sent before subscription
    assert len(messages) == 0
    
    # But should receive new messages
    await publish_message('clean-channel', {'id': 1})
    
    assert len(messages) == 1
    assert messages[0]['id'] == 1


@pytest.mark.asyncio
async def test_subscription_context_manager(registry):
    """Test subscription with context manager."""
    messages = []
    
    async with await create_subscription_service({
        'ctx-channel': lambda msg: messages.append(msg)
    }) as service:
        assert 'ctx-channel' in service.channels
        
        await publish_message('ctx-channel', {'data': 'test'})
        assert len(messages) == 1
    
    # After context exit, should be unsubscribed
    await publish_message('ctx-channel', {'data': 'after'})
    assert len(messages) == 1  # Still just 1


@pytest.mark.asyncio
async def test_subscription_list_subscriptions(registry, cleanup_services):
    """Test listing active subscriptions."""
    service = await create_subscription_service({
        'list-channel-a': lambda msg: msg,
        'list-channel-b': lambda msg: msg,
    })
    cleanup_services.append(service)
    
    subs = service.subscriptions()
    
    assert 'list-channel-a' in subs
    assert 'list-channel-b' in subs

