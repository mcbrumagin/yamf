import {
  createService,
  Logger,
  publishMessage,
  envConfig,
  HttpError
} from '@yamf/core'

import { sanitizePathSegment } from '@yamf/shared'
import busboy from 'busboy'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import path from 'path'
import crypto from 'crypto'

let logger = new Logger({ logGroup: 'file-upload-service' })

function sanitizeFilename(filename) {
  return sanitizePathSegment(path.basename(filename || 'unnamed'))
}

/** Sniff MIME from first bytes (do not trust client Content-Type) */
function sniffMimeFromBuffer(buf) {
  if (!buf || buf.length < 1) return 'application/octet-stream'
  const b = buf
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'image/webp'
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  if (b[0] === 0x50 && b[1] === 0x4b) return 'application/zip'
  return 'application/octet-stream'
}

function mimeAllowed(sniffed, allowList) {
  if (!allowList || allowList.length === 0) return true
  return allowList.some((t) => {
    if (t.endsWith('/*')) return sniffed.startsWith(t.slice(0, -1))
    return sniffed === t
  })
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
async function verifyFileMagicIfNeeded(finalPath, acceptMime) {
  if (!acceptMime || acceptMime.length === 0) return
  const fh = await fsPromises.open(finalPath, 'r')
  try {
    const buf = Buffer.alloc(32)
    await fh.read(buf, 0, 32, 0)
    const sniffed = sniffMimeFromBuffer(buf)
    if (!mimeAllowed(sniffed, acceptMime)) {
      throw new HttpError(415, `content type mismatch: detected ${sniffed}`)
    }
  } finally {
    await fh.close()
  }
}

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
    acceptMime = null,
    onAllocate = null,
    auditUpload = null,
    serviceName: uploadServiceName = 'file-upload-service'
  } = options

  const envCap = Number(envConfig.get('YAMF_UPLOAD_MAX_BYTES', 25 * 1024 * 1024))
  const effectiveMax = maxFileSize != null ? Math.min(maxFileSize, envCap) : envCap

  const limits = {}
  limits.fileSize = effectiveMax
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

  const postProcessSavedFile = async (finalPath, stats, { filename, mimeType }) => {
    try {
      await verifyFileMagicIfNeeded(finalPath, acceptMime)
    } catch (err) {
      await fsPromises.unlink(finalPath).catch(() => {})
      throw err
    }
    if (onAllocate) {
      const r = await onAllocate({
        userId: formData.userId ?? formData.user_id,
        bytes: stats.size
      })
      if (r && r.allow === false) {
        await fsPromises.unlink(finalPath).catch(() => {})
        throw new HttpError(403, r.reason || 'upload not allowed')
      }
    }
    if (auditUpload) {
      try {
        await auditUpload({
          userId: formData.userId,
          service: uploadServiceName,
          bytes: stats.size,
          mime: mimeType,
          hash: null,
          ip: req.socket?.remoteAddress,
          path: finalPath,
          originalName: filename
        })
      } catch (e) {
        logger.debugErr('upload audit callback failed', e)
      }
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
          await postProcessSavedFile(finalPath, stats, { filename, mimeType })
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
        await postProcessSavedFile(finalPath, stats, { filename, mimeType })

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
    const status = error instanceof HttpError ? error.status : 500
    const errorData = { success: false, error: message, details: error?.message }
    if (onError) {
      onError(errorData, error, req, res)
    } else {
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' })
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
  maxBytes = null,
  maxFiles = null,
  acceptMime = null,
  onAllocate = null,
  auditUploads = false,

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
        try {
          await onSuccess(successData, req, res)
        } catch (err) {
          const code = err && err.code
          const msg = (err && err.message) || ''
          if (code === 'ERR_HTTP_HEADERS_SENT' || /headers.*sent|Cannot set headers/i.test(msg)) {
            logger.warn('onSuccess tried to write after the response was already sent; ignoring duplicate send', { message: msg })
            return
          }
          throw err
        }
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
      maxFileSize: maxBytes ?? maxFileSize,
      maxFiles,
      acceptMime,
      onAllocate,
      serviceName,
      auditUpload: auditUploads
        ? async (info) => {
            try {
              await publishMessage('yamf:upload', { ...info, at: Date.now() })
            } catch (err) {
              logger.debugErr('yamf:upload publish failed (registry may be down):', err?.message)
            }
          }
        : null
    })
    
    // Return false: framework must not send a second response (multipart handler ends the response).
    return false
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
