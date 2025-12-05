# @yamf/services-file-upload

Multipart file upload service for YAMF microservices with validation and metadata extraction.

[![Version](https://img.shields.io/badge/version-0.1.2-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## Installation

```bash
npm install @yamf/services-file-upload
```

**Note:** This service requires the `busboy` package as a runtime dependency (the only YAMF service with external dependencies).

## Quick Start

```javascript
import { createFileUploadService } from '@yamf/services-file-upload'

const uploadService = await createFileUploadService({
  uploadDir: './uploads',
  fileFieldName: 'file',
  textFields: ['title', 'description'],
  validateFile: (filename, mimetype) => {
    return mimetype.startsWith('image/')
  }
})

// Upload via HTTP POST with multipart/form-data
// POST /upload
// Content-Type: multipart/form-data; boundary=----...
// 
// File will be saved to ./uploads/filename-timestamp.ext
```

## Features

- **Multipart Form Data** - Standard HTML form uploads
- **File Validation** - Custom validation callbacks
- **Metadata Extraction** - Capture additional form fields
- **Unique Filenames** - Automatic timestamp-based naming
- **Error Handling** - Comprehensive error messages
- **Stream Processing** - Memory-efficient file handling

## Configuration

```javascript
await createFileUploadService({
  uploadDir: './uploads',           // Directory for uploaded files
  fileFieldName: 'file',            // Form field name for file
  textFields: ['title', 'author'],  // Additional fields to capture
  maxFileSize: 10485760,            // 10MB limit (optional)
  validateFile: (filename, mimetype) => {
    // Return true to allow, false to reject
    const allowed = ['image/jpeg', 'image/png', 'application/pdf']
    return allowed.includes(mimetype)
  }
})
```

## Usage

### HTML Form

```html
<form action="/upload" method="POST" enctype="multipart/form-data">
  <input type="text" name="title" placeholder="Title">
  <input type="text" name="description" placeholder="Description">
  <input type="file" name="file">
  <button type="submit">Upload</button>
</form>
```

### JavaScript Fetch

```javascript
const formData = new FormData()
formData.append('title', 'My Document')
formData.append('description', 'Important file')
formData.append('file', fileInput.files[0])

const response = await fetch('/upload', {
  method: 'POST',
  body: formData
})

const result = await response.json()
console.log(result)
// {
//   success: true,
//   filename: 'document-1234567890.pdf',
//   metadata: {
//     title: 'My Document',
//     description: 'Important file'
//   }
// }
```

### With YAMF Routes

```javascript
import { createRoute } from '@yamf/core'
import { createFileUploadService } from '@yamf/services-file-upload'

// Create upload service
await createFileUploadService({
  uploadDir: './uploads',
  fileFieldName: 'audio',
  textFields: ['title', 'artist', 'album']
})

// Create route for uploads
await createRoute('/api/upload', 'fileUploadService')
```

## File Validation

### Validate by MIME Type

```javascript
validateFile: (filename, mimetype) => {
  return mimetype.startsWith('image/')
}
```

### Validate by Extension

```javascript
validateFile: (filename, mimetype) => {
  const ext = filename.split('.').pop().toLowerCase()
  return ['jpg', 'jpeg', 'png', 'gif'].includes(ext)
}
```

### Validate by Size and Type

```javascript
validateFile: (filename, mimetype, size) => {
  const maxSize = 5 * 1024 * 1024 // 5MB
  const allowedTypes = ['image/jpeg', 'image/png']
  
  return size <= maxSize && allowedTypes.includes(mimetype)
}
```

## Response Format

### Success

```json
{
  "success": true,
  "filename": "myfile-1701234567890.jpg",
  "path": "/uploads/myfile-1701234567890.jpg",
  "metadata": {
    "title": "Sunset Photo",
    "description": "Beautiful sunset"
  }
}
```

### Validation Error

```json
{
  "error": "File validation failed",
  "filename": "document.exe",
  "mimetype": "application/x-msdownload"
}
```

### Upload Error

```json
{
  "error": "File upload failed",
  "message": "Disk quota exceeded"
}
```

## Security Considerations

- **Validate File Types** - Always validate MIME types and extensions
- **Limit File Sizes** - Set reasonable file size limits
- **Sanitize Filenames** - Service automatically generates safe filenames
- **Directory Permissions** - Ensure upload directory has correct permissions
- **Virus Scanning** - Consider integrating virus scanning for production use

## Common Patterns

### Image Upload with Processing

```javascript
await createFileUploadService({
  uploadDir: './temp',
  validateFile: (filename, mimetype) => mimetype.startsWith('image/'),
  onFileUploaded: async (filepath, metadata) => {
    // Process image (resize, convert, etc.)
    const processed = await processImage(filepath)
    
    // Move to final location
    await moveFile(processed, './images/')
    
    // Clean up temp file
    await unlink(filepath)
  }
})
```

### Audio File Uploads

```javascript
await createFileUploadService({
  uploadDir: './audio',
  fileFieldName: 'track',
  textFields: ['title', 'artist', 'album', 'genre'],
  validateFile: (filename, mimetype) => {
    return ['audio/mpeg', 'audio/wav', 'audio/ogg'].includes(mimetype)
  }
})
```

## Dependencies

- `busboy` (^1.6.0) - Multipart form data parsing

This is currently the only YAMF service module with external dependencies.

## License

MIT
