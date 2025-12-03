"""
YAMF HTTP Server

Async HTTP server for hosting services.
"""

import json
import logging
from typing import Any, Callable, Awaitable, Optional
from aiohttp import web

from ..errors import HttpError

logger = logging.getLogger('yamf.http')

Handler = Callable[[Any, web.Request], Awaitable[Any]]


class HttpServer:
    """Async HTTP server wrapper."""
    
    def __init__(self, runner: web.AppRunner, port: int):
        self._runner = runner
        self._port = port
        self._handler: Handler = None  # Will be set after creation
    
    @property
    def port(self) -> int:
        return self._port
    
    @property
    def handler(self) -> Handler:
        return self._handler
    
    @handler.setter
    def handler(self, value: Handler) -> None:
        self._handler = value
    
    async def stop(self) -> None:
        """Stop the HTTP server."""
        await self._runner.cleanup()


async def create_http_server(
    port: int,
    handler: Handler,
    *,
    stream_payload: bool = False
) -> HttpServer:
    """
    Create and start an async HTTP server.
    
    Args:
        port: Port to listen on
        handler: Async handler function(payload, request) -> response
        stream_payload: If True, pass raw request body instead of parsed JSON
    
    Returns:
        HttpServer instance with stop() method
    
    Raises:
        OSError: If port is already in use
    """
    # Create server instance first so we can reference it in the handler
    # This allows handler to be swapped dynamically (e.g., via before())
    server_holder = {'server': None}
    
    async def request_handler(request: web.Request) -> web.Response:
        """Wrap user handler with request/response handling."""
        try:
            # Parse request body
            if stream_payload:
                payload = await request.read()
            else:
                body = await request.text()
                if body:
                    try:
                        payload = json.loads(body)
                    except json.JSONDecodeError:
                        payload = body
                else:
                    payload = None  # Empty body = None, not {}
            
            # Call user handler - use server's handler property for dynamic lookup
            current_handler = server_holder['server'].handler
            result = await current_handler(payload, request)
            
            # Handle response
            if isinstance(result, web.Response):
                return result
            
            if result is None:
                return web.Response(status=204)
            
            # Use JSON for all JSON-serializable types (dict, list, bool, int, float, str, None)
            # This ensures True stays True, not "True"
            if isinstance(result, (dict, list, bool, int, float)):
                return web.json_response(result)
            
            if isinstance(result, bytes):
                return web.Response(body=result)
            
            # String - return as text (could be HTML, plain text, etc.)
            return web.Response(text=str(result))
            
        except HttpError as e:
            # Preserve HttpError status codes
            logger.error(f"Handler error: {e}")
            return web.json_response({'error': e.message}, status=e.status_code)
        except Exception as e:
            logger.error(f"Handler error: {e}")
            return web.json_response({'error': str(e)}, status=500)
    
    # Create application
    app = web.Application()
    app.router.add_route('*', '/{path_info:.*}', request_handler)
    
    # Start server
    try:
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, '0.0.0.0', port)
        await site.start()
        
        logger.debug(f"HTTP server listening on port {port}")
        server = HttpServer(runner, port)
        server.handler = handler  # Set initial handler
        server_holder['server'] = server  # Enable dynamic lookup
        return server
        
    except OSError as e:
        if e.errno in (48, 98):  # EADDRINUSE on macOS/Linux
            raise OSError(f"Address already in use on port {port}") from e
        raise

