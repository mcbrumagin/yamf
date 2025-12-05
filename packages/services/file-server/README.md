# @yamf/services-file-server

Static file serving service for YAMF microservices with flexible routing and security features.

[![Version](https://img.shields.io/badge/version-0.1.2-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## Installation

```bash
npm install @yamf/services-file-server
```

## Quick Start

```javascript
import { createStaticFileService } from '@yamf/services-file-server'

const staticServer = await createStaticFileService({
  rootDir: './public',
  urlRoot: '/assets',
  fileMap: {
    '/': 'index.html',
    '/styles/*': 'css',
    '/scripts/*': 'js',
    '/images/*': 'images'
  }
})

// Now visit: http://localhost:9999/assets/styles/main.css
```

## Features

- **Flexible Routing** - Map URL patterns to file paths
- **MIME Type Detection** - Automatic content-type headers
- **Range Request Support** - Enable audio/video seeking
- **Path Traversal Protection** - Basic security features
- **Wildcard Patterns** - Directory-level routing
- **Auto-refresh** - Development mode with live reload

## Configuration

### Basic Setup

```javascript
await createStaticFileService({
  rootDir: './public',      // Base directory for files
  urlRoot: '/static',       // URL prefix
  simpleSecurity: true      // Enable path traversal protection
})
```

### File Mapping

```javascript
await createStaticFileService({
  rootDir: './public',
  fileMap: {
    // Direct mapping
    '/': 'index.html',
    
    // Wildcard directory mapping
    '/css/*': 'styles',
    '/js/*': 'scripts',
    
    // Specific file mapping
    '/favicon.ico': 'assets/favicon.ico',
    
    // Nested paths
    '/assets/images/*': 'public/images'
  }
})
```

## URL Patterns

### Direct Files

```javascript
fileMap: {
  '/': 'index.html',              // http://localhost/
  '/about': 'about.html'          // http://localhost/about
}
```

### Wildcard Directories

```javascript
fileMap: {
  '/styles/*': 'css',             // http://localhost/styles/main.css
  '/scripts/*': 'js',             // http://localhost/scripts/app.js
  '/downloads/*': 'public/files'  // http://localhost/downloads/doc.pdf
}
```

## Advanced Features

### Range Requests (Audio/Video Streaming)

The file server automatically supports HTTP range requests, enabling:
- Video/audio seeking
- Bandwidth-efficient streaming
- Progressive downloads

```javascript
// Range requests are enabled by default
// Browser automatically sends: Range: bytes=0-1023
// Server responds with: 206 Partial Content
```

### Auto-refresh (Development Mode)

```javascript
import { createStaticFileService } from '@yamf/services-file-server'

await createStaticFileService({
  rootDir: './public',
  autoRefresh: true,      // Enable live reload
  refreshInterval: 1000   // Check every second
})
```

## Security

### Path Traversal Protection

```javascript
await createStaticFileService({
  simpleSecurity: true  // Blocks paths with '..' or null bytes
})

// Blocked requests:
// - /files/../../../etc/passwd
// - /files/%00.txt
// - /files/..%2F..%2Fetc%2Fpasswd
```

## MIME Types

Automatic content-type detection for common file types:

- **Text**: `.html`, `.css`, `.js`, `.txt`, `.json`, `.xml`
- **Images**: `.jpg`, `.png`, `.gif`, `.svg`, `.webp`, `.ico`
- **Audio**: `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`
- **Video**: `.mp4`, `.webm`, `.ogv`, `.mov`
- **Documents**: `.pdf`, `.zip`, `.tar`, `.gz`

## Use Cases

- Serve static website assets
- Host downloadable files
- Stream audio/video content
- Provide API documentation
- Development server with live reload

## Performance

- **Streaming** - Files are streamed, not loaded into memory
- **Caching** - Browser caching headers included
- **Range Requests** - Efficient partial content delivery
- **Zero Dependencies** - Pure Node.js implementation

## License

MIT
