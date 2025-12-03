"""
YAMF HTTP Client

Async HTTP client for making requests to registry and services.
"""

import json
import logging
from typing import Any, Optional
import aiohttp

from ..errors import HttpError

logger = logging.getLogger('yamf.http')


async def http_request(
    url: str,
    *,
    method: str = 'POST',
    headers: Optional[dict[str, str]] = None,
    body: Any = None,
    timeout: int = 30,
    parse_json: bool = True
) -> Any:
    """
    Make an async HTTP request.
    
    Args:
        url: Full URL to request
        method: HTTP method (default POST for yamf protocol)
        headers: Optional headers dict
        body: Request body (will be JSON serialized if dict/list)
        timeout: Request timeout in seconds
        parse_json: Whether to parse response as JSON
    
    Returns:
        Parsed JSON response, or text if parse_json=False
    
    Raises:
        HttpError: On non-2xx response
        Exception: On network/timeout errors
    """
    timeout_config = aiohttp.ClientTimeout(total=timeout)
    
    # Prepare body - serialize as JSON
    # We use a sentinel to distinguish "no body argument" from "body=None"
    data = None
    if headers is None:
        headers = {}
    
    # Serialize body as JSON for JSON-serializable types
    if isinstance(body, (dict, list, bool, int, float, type(None))):
        data = json.dumps(body)  # None becomes "null"
        headers.setdefault('Content-Type', 'application/json')
    elif isinstance(body, str):
        data = body
    elif body is not None:
        data = body
    
    try:
        async with aiohttp.ClientSession(timeout=timeout_config) as session:
            async with session.request(method, url, headers=headers, data=data) as response:
                text = await response.text()
                
                if response.status >= 400:
                    raise HttpError(response.status, text)
                
                if parse_json and text:
                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        # Return as string if not valid JSON
                        return text.strip().strip('"')
                
                return text
                
    except aiohttp.ClientError as e:
        logger.error(f"HTTP request failed to {url}: {e}")
        raise Exception(f"HTTP request failed to {url}: {e}") from e
    except TimeoutError:
        raise Exception(f"HTTP request timeout after {timeout}s to {url}")

