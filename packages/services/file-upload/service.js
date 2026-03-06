import {
  createService,
  Logger
} from '@yamf/core'

import busboy from 'busboy'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import path from 'path'
import crypto from 'crypto'

let logger = new Logger({ logGroup: 'file-upload-service' })

/**
 * Sanitize a filename to prevent path traversal attacks.
 * Strips directory components and .. sequences.
 */
function sanitizeFilename(filename) {
  return path.basename(filename || 'unnamed').replace(/\.\./g, '').replace(/\0/g, '') || 'unnamed'
}

/**
 * Handles streaming multipart file upload (single or multi-file).
 *
 * When multiFile is false (default): scalar state, onSuccess receives { file, fields }.
 * When multiFile is true: array state, onSuccess receives { files: [...], fields }.
 *
 * Files are written to a temporary location with a crypto-generated name,
 * then renamed to the final name once all form fields are received.
 */
function handleStreamingUpload(_payload, req, res, options) {
  const {
    uploadDir,
    fileFieldName,
    textFields = [],
    getFileName = null,
    validateFile = null,
    onSuccess = null,
    onError = null,
    multiFile = false,
    maxFileSize = null,
    maxFiles = null,
  } = options

  const limits = {}
  if (maxFileSize) limits.fileSize = maxFileSize
  if (maxFiles) limits.files = maxFiles

  const bb = busboy({ headers: req.headers, limits })

  const formData = {}
  let uploadError = null
  let busboyFinished = false

  // -- Single-file state (multiFile === false) --
  let writeStreamPromise = null
  let tempFilePath = null
  let originalFileInfo = null

  // -- Multi-file state (multiFile === true) --
  const fileEntries = []

  const cleanupTempFiles = async (entries) => {
    for (const entry of entries) {
      try { await fsPromises.unlink(entry.tempFilePath) } catch {}
    }
  }

  const finishUpload = async () => {
    if (!busboyFinished) return

    if (multiFile) {
      if (fileEntries.length === 0) {
        logger.warn('No files uploaded')
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: 'No files uploaded' }))
        }
        return
      }

      try {
        await Promise.all(fileEntries.map(e => e.writePromise))

        const uploadedFiles = []
        for (const entry of fileEntries) {
          const { filename, encoding, mimeType } = entry.originalInfo
          let finalFileName = sanitizeFilename(filename)
          if (getFileName) {
            finalFileName = getFileName(finalFileName, formData)
          }
          const finalPath = path.join(uploadDir, finalFileName)
          await fsPromises.rename(entry.tempFilePath, finalPath)
          const stats = await fsPromises.stat(finalPath)
          uploadedFiles.push({
            originalName: filename,
            savedName: finalFileName,
            mimeType, encoding,
            path: finalPath,
            size: stats.size
          })
          logger.info('File upload completed', { fileName: finalFileName, size: stats.size })
        }

        const successData = {
          success: true,
          message: `${uploadedFiles.length} file(s) uploaded successfully`,
          files: uploadedFiles,
          fields: formData
        }

        if (onSuccess) {
          await onSuccess(successData, req, res)
        } else {
          if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/json' })
          if (!res.writableEnded) res.end(JSON.stringify(successData))
        }
      } catch (err) {
        logger.error('Error finalizing multi-file upload:', err)
        await cleanupTempFiles(fileEntries)
        handleError(err, 'Failed to save files')
      }
    } else {
      // Single-file path (original behavior)
      if (!writeStreamPromise) {
        logger.warn('No file uploaded')
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: 'No file uploaded' }))
        }
        return
      }

      try {
        await writeStreamPromise
        const { filename, encoding, mimeType } = originalFileInfo
        let finalFileName = sanitizeFilename(filename)
        if (getFileName) {
          finalFileName = getFileName(finalFileName, formData)
        }
        const finalPath = path.join(uploadDir, finalFileName)
        await fsPromises.rename(tempFilePath, finalPath)
        const stats = await fsPromises.stat(finalPath)

        const uploadedFileInfo = {
          originalName: filename,
          savedName: finalFileName,
          mimeType, encoding,
          path: finalPath,
          size: stats.size
        }

        logger.info('Upload completed successfully', { fileName: finalFileName, size: stats.size })

        const successData = {
          success: true,
          message: 'File uploaded successfully',
          file: uploadedFileInfo,
          fields: formData
        }

        if (onSuccess) {
          await onSuccess(successData, req, res)
        } else {
          if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/json' })
          if (!res.writableEnded) res.end(JSON.stringify(successData))
        }
      } catch (err) {
        logger.error('Error finalizing upload:', err)
        if (tempFilePath) {
          try { await fsPromises.unlink(tempFilePath) } catch {}
        }
        handleError(err, 'Failed to save file')
      }
    }
  }

  const handleError = (error, message = 'Upload failed') => {
    if (res.headersSent) return
    const errorData = { success: false, error: message, details: error?.message }
    if (onError) {
      onError(errorData, error, req, res)
    } else {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      if (!res.writableEnded) res.end(JSON.stringify(errorData))
    }
  }

  bb.on('file', (fieldname, file, info) => {
    if (fieldname !== fileFieldName) {
      file.resume()
      return
    }

    const { filename, encoding, mimeType } = info
    logger.info(`Receiving file: ${filename} (${mimeType})`)

    if (validateFile) {
      const validationResult = validateFile(info, formData)
      if (!validationResult.valid) {
        uploadError = new Error(validationResult.error)
        logger.warn('File validation failed:', validationResult.error)
        file.resume()
        return
      }
    }

    const tempFileName = `upload-${crypto.randomBytes(16).toString('hex')}.tmp`
    const currentTempPath = path.join(uploadDir, tempFileName)

    const writeStream = fs.createWriteStream(currentTempPath)
    file.pipe(writeStream)

    let fileTruncated = false
    file.on('limit', () => {
      fileTruncated = true
      logger.warn(`File size limit exceeded for: ${filename}`)
    })

    const writePromise = new Promise((resolve, reject) => {
      writeStream.on('error', (err) => {
        logger.error('Error writing temp file:', err)
        uploadError = err
        file.resume()
        reject(err)
      })
      writeStream.on('finish', () => {
        if (fileTruncated) {
          const err = new Error(`File "${sanitizeFilename(filename)}" exceeds maximum size limit`)
          uploadError = err
          fsPromises.unlink(currentTempPath).catch(() => {})
          reject(err)
          return
        }
        logger.debug(`Temp file written successfully: ${tempFileName}`)
        resolve()
      })
    })

    if (multiFile) {
      fileEntries.push({ tempFilePath: currentTempPath, writePromise, originalInfo: info })
    } else {
      originalFileInfo = info
      tempFilePath = currentTempPath
      writeStreamPromise = writePromise
    }
  })

  bb.on('field', (fieldname, val) => {
    if (textFields.length === 0 || textFields.includes(fieldname)) {
      formData[fieldname] = val
    }
  })

  bb.on('close', async () => {
    logger.debug('Busboy parsing complete')

    if (uploadError) {
      if (multiFile) {
        await cleanupTempFiles(fileEntries)
      } else if (tempFilePath) {
        try { await fsPromises.unlink(tempFilePath) } catch {}
      }
      return handleError(uploadError, uploadError.message || 'Failed to process file')
    }

    busboyFinished = true
    finishUpload()
  })

  bb.on('error', (err) => {
    logger.error('Busboy error:', err)
    handleError(err, 'Failed to parse multipart data')
  })

  req.pipe(bb)
}

/**
 * Create upload directory if it doesn't exist
 * @param {string} uploadDir - Directory path to create
 */
async function ensureUploadDir(uploadDir) {
  try {
    await fsPromises.access(uploadDir)
  } catch {
    await fsPromises.mkdir(uploadDir, { recursive: true })
    logger.info(`Created upload directory: ${uploadDir}`)
  }
}

/**
 * Get list of uploaded files in a directory
 * @param {string} uploadDir - Directory to list files from
 * @returns {Promise<Array>} Array of file information objects
 */
async function listUploadedFiles(uploadDir) {
  try {
    const files = await fsPromises.readdir(uploadDir)
    
    const fileList = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(uploadDir, file)
        const stats = await fsPromises.stat(filePath)
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime,
          path: filePath,
          isDirectory: stats.isDirectory()
        }
      })
    )

    return fileList.filter(f => !f.isDirectory)
  } catch (err) {
    logger.error('Error listing uploaded files:', err)
    throw err
  }
}

/**
 * Common file validators
 */
const validators = {
  /**
   * Validate file by mime type
   * @param {Array<string>} allowedTypes - Array of allowed mime types or patterns
   */
  mimeType: (allowedTypes) => {
    return (fileInfo, formData) => {
      const matches = allowedTypes.some(type => {
        if (type.endsWith('/*')) {
          // Pattern match (e.g., 'audio/*', 'image/*')
          const prefix = type.slice(0, -2)
          return fileInfo.mimeType.startsWith(prefix)
        }
        return fileInfo.mimeType === type
      })

      if (!matches) {
        return {
          valid: false,
          error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`
        }
      }

      return { valid: true }
    }
  },

  /**
   * Validate file by extension
   * @param {Array<string>} allowedExtensions - Array of allowed extensions (with or without dot)
   */
  extension: (allowedExtensions) => {
    return (fileInfo, formData) => {
      const ext = path.extname(fileInfo.filename).toLowerCase()
      const normalizedExts = allowedExtensions.map(e => e.startsWith('.') ? e : '.' + e)
      
      if (!normalizedExts.includes(ext)) {
        return {
          valid: false,
          error: `Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`
        }
      }

      return { valid: true }
    }
  },

  /**
   * Combine multiple validators
   * @param {Array<Function>} validatorFns - Array of validator functions
   */
  combine: (...validatorFns) => {
    return (fileInfo, formData) => {
      for (const validator of validatorFns) {
        const result = validator(fileInfo, formData)
        if (!result.valid) {
          return result
        }
      }
      return { valid: true }
    }
  }
}

/**
 * Create a file upload service
 * @param {Object} options - Configuration options
 * @param {string} options.uploadDir - Directory to save uploaded files (default: ./uploads)
 * @param {string} options.fileFieldName - Name of the file input field (default: 'file')
 * @param {Array<string>} options.textFields - Array of text field names to capture (default: [] - capture all)
 * @param {Function} options.getFileName - Function to determine final filename (optional)
 * @param {Function} options.validateFile - Function to validate file before saving (optional)
 * @param {Function} options.onSuccess - Callback on successful upload (optional)
 * @param {Function} options.onError - Callback on error (optional)
 * @returns {Promise<Service>} The created service
 */
export default async function createFileUploadService({
  serviceName = 'file-upload-service',
  uploadDir = path.join(process.cwd(), 'uploads'),
  fileFieldName = 'file',
  textFields = [],
  getFileName = null,
  validateFile = null,
  onSuccess = null,
  onError = null,
  useAuthService = null,
  urlPathPrefix = '/uploads',

  multiFile = false,
  maxFileSize = null,
  maxFiles = null,
  
  // auto-publish upload events
  publishFileEvents = false,
  updateChannel = 'yamf:file-updated',
  deleteChannel = 'yamf:file-deleted'
} = {}) {
  let logger = new Logger({ logGroup: serviceName })
  // Ensure upload directory exists
  await ensureUploadDir(uploadDir)
  logger.info(`File upload service configured with uploadDir: ${uploadDir}`)

  const server = await createService(serviceName, async function fileUploadService(payload, request, response) {
    // The service is designed to work with HTTP multipart requests
    // It handles the response internally and returns false to signal this
    
    const publishFileEvent = async (file) => {
      if (!publishFileEvents) return
      try {
        const urlPath = path.join(urlPathPrefix, file.savedName).replace(/\\/g, '/')
        await this.publish(updateChannel, {
          urlPath,
          filePath: file.path,
          size: file.size,
          mimeType: file.mimeType,
          originalName: file.originalName,
          savedName: file.savedName,
          timestamp: Date.now()
        })
      } catch (err) {
        logger.error('Failed to publish file event:', err)
      }
    }

    const wrappedOnSuccess = async (successData, req, res) => {
      if (multiFile && successData.files) {
        for (const file of successData.files) await publishFileEvent(file)
      } else if (successData.file) {
        await publishFileEvent(successData.file)
      }

      if (onSuccess) {
        await onSuccess(successData, req, res)
      } else {
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/json' })
        if (!res.writableEnded) res.end(JSON.stringify(successData))
      }
    }
    
    handleStreamingUpload(payload, request, response, {
      uploadDir,
      fileFieldName,
      textFields,
      getFileName,
      validateFile,
      onSuccess: wrappedOnSuccess,
      onError,
      multiFile,
      maxFileSize,
      maxFiles,
    })
    
    // Return false to indicate that the response is handled by the function itself
    // This prevents the framework from trying to send another response
    return false // TODO return next()? preventDefault()? next({ preventDefault: true })?
    // return next({ reason: 'file upload', file: filePath })
  }, {
    useAuthService,
    streamPayload: true // Don't buffer the request - we need the raw stream for multipart uploads
  })

  // Attach helper functions to the service
  server.ensureUploadDir = ensureUploadDir
  server.listUploadedFiles = () => listUploadedFiles(uploadDir)
  server.getUploadDir = () => uploadDir

  /**
   * Helper to manually upload a file and publish event
   * @param {string} filePath - Full path where file should be written
   * @param {string|Buffer} fileData - File content to write
   */
  server.uploadFile = async function uploadFile(filePath, fileData) {
    await fsPromises.writeFile(filePath, fileData)

    if (publishFileEvents) {
      const fileName = path.basename(filePath)
      const urlPath = path.join(urlPathPrefix, fileName).replace(/\\/g, '/')
      
      // TODO seems like the static-file-service does not realize this is a publish command
      await server.context.publish(updateChannel, {
        urlPath,
        filePath,
        fileName,
        timestamp: Date.now()
      })
    }
  }

  /**
   * Helper to manually delete a file and publish event
   * @param {string} filePath - Full path to file to delete
   */
  server.deleteFile = async function deleteFile(filePath) {
    await fsPromises.unlink(filePath)
    
    if (publishFileEvents) {
      const fileName = path.basename(filePath)
      const urlPath = path.join(urlPathPrefix, fileName).replace(/\\/g, '/')
      
      await server.context.publish(deleteChannel, {
        urlPath,
        filePath,
        fileName,
        timestamp: Date.now()
      })
    }
  }

  // Override terminate to log cleanup
  const originalTerminate = server.terminate.bind(server)
  server.terminate = async () => {
    logger.info('Terminating file upload service')
    await originalTerminate()
    logger.info('File upload service terminated')
  }

  return server
}

// Export helper utilities for use in other modules
export { ensureUploadDir, listUploadedFiles, validators, sanitizeFilename }
