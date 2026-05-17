import {
  createService,
  createSubscriptionService,
  Logger,
  HttpError,
  next,
  detectContentType
} from '@yamf/core'
import { isPathUnderRoot, URL_PATH_DANGEROUS_CTRL_RE } from '@yamf/shared'

import path from 'node:path'
import fs from 'node:fs'
import fsAsync from 'node:fs/promises'

let logger = new Logger({ logGroup: 'static-files' })

/* --- example filemap ---
{
  '/': 'index.html',
  '/styles/main.css': 'public/main.css',
  '/assets/*': 'public/assets',
  '/modules/*': 'node_modules',
  '/*': 'index.html'  // catch-all: return index.html for any unmatched path (SPA fallback)
}
*/

const endsWithValidWildcard = new RegExp('^.*\/\*$')
const isRoot = new RegExp('^/$')
const isFilePath = new RegExp('^.*\/.*$')


function validateMapEntry(rootDir, item, target) {
  if (item.length === 0) {
    return new Error(`fileMap url route cannot be empty: "${item}"`)
  } else if (!endsWithValidWildcard.test(item) && !isFilePath.test(item) && !isRoot.test(item)) {
    return new Error(`fileMap url route must end with '/*' or be a file path with extension: "${item}"`)
  }

  if (target.length === 0) {
    return new Error(`fileMap file path cannot be empty: "${target}"`)
  } else if (!endsWithValidWildcard.test(target) && !isFilePath.test(target)) {
    return new Error(`fileMap file path must end with '/*' or be a file path with extension: "${target}"`)
  }

  // check if target path exists (strip wildcard for directory check)
  const targetPath = target.endsWith('/*') ? target.slice(0, -2) : target
  const targetFsPath = targetPath.startsWith('/') ? path.join(rootDir, targetPath.slice(1)) : path.join(rootDir, targetPath)
  if (!fs.existsSync(targetFsPath)) {
    return new Error(`fileMap file path does not exist: "${target}"`)
  }
}

function populateQuickLookupForDirectoryTree(quickLookup, rootDir, urlRoute, targetDir) {
  const targetDirFs = targetDir.startsWith('/') ? targetDir.slice(1) : targetDir

  // check that target is a directory
  if (!fs.statSync(path.join(rootDir, targetDirFs)).isDirectory()) {
    throw new Error(`fileMap file path is not a directory: "${targetDir}"`)
  }

  // TODO read all files/folders in the directory and recursively add to quickLookup
  const urlPrefix = urlRoute
  const files = fs.readdirSync(path.join(rootDir, targetDirFs))

  for (let file of files) {
    const urlPath = urlPrefix === '' ? `/${file}` : `${urlPrefix}/${file}`
    if (fs.statSync(path.join(rootDir, targetDirFs, file)).isDirectory()) {
      // TODO VERIFY
      populateQuickLookupForDirectoryTree(quickLookup, rootDir, urlPath, `${targetDirFs}/${file}`)
    } else {
      quickLookup[urlPath] = path.join(rootDir, targetDirFs, file)
    }
  }
}

function targetToFsPath(rootDir, target) {
  const relative = target.startsWith('/') ? target.slice(1) : target
  return path.join(rootDir, relative)
}

function generateQuickLookupMap(fileMap, urlRoot, rootDir, skipValidation = false) {
  // even though the map doesn't have nesting, the file structure can
  const quickLookup = {}
  let catchAllFallbackPath = null
  let errors = []

  for (let urlRoute in fileMap) {
    let target = fileMap[urlRoute]

    urlRoute = normalizePath(urlRoute)
    target = normalizePath(target)

    if (!skipValidation) {
      const err = validateMapEntry(rootDir, urlRoute, target)
      if (err) errors.push(err)
    }

    const createSpecificFileMapping = (urlRoute, target) => {
      if (urlRoute.endsWith('/')) {
        let explicitFileItem = `${urlRoute}${target.split('/').pop()}`
        quickLookup[explicitFileItem] = targetToFsPath(rootDir, target)
      }
    }

    if (urlRoute === '/*') {
      // Catch-all: return a default file for any unmatched path (e.g. SPA index.html)
      const targetFsPath = targetToFsPath(rootDir, target)
      if (fs.statSync(targetFsPath).isDirectory()) {
        // Target is directory: treat like /* mapping - populate from root
        populateQuickLookupForDirectoryTree(quickLookup, rootDir, '', target)
      } else {
        catchAllFallbackPath = targetFsPath
      }
    } else if (urlRoute.endsWith('/*')) {
      // Wildcard mapping, recursively populate directory tree
      urlRoute = urlRoute.slice(0, -2) // remove /*
      populateQuickLookupForDirectoryTree(quickLookup, rootDir, urlRoute, target)

    } else if (urlRoute === '/') {
      quickLookup['/'] = targetToFsPath(rootDir, target)
      createSpecificFileMapping(urlRoute, target)

    } else {
      quickLookup[urlRoute] = targetToFsPath(rootDir, target)
      createSpecificFileMapping(urlRoute, target)

    }
  }

  if (errors.length > 0) {
    throw new Error(`Errors in static-file-service filemap: ${errors.join('\n')}`)
  }

  return { quickLookup, catchAllFallbackPath }
}


function normalizePath(path) {
  // default to root
  if (!path) return '/'
  
  // ensure path starts with "/"
  if (!path.startsWith('/')) path = '/' + path
  
  // remove trailing slash unless it's the root
  if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1)

  return path
}

function getPathnameFromUrl(url) {
  if (!url) return '/'
  if (typeof url !== 'string') return '/'
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      return new URL(url).pathname || '/'
    } catch {
      return '/'
    }
  }
  const withoutQuery = url.split('?')[0] || '/'
  return withoutQuery || '/'
}

function hasFileExtension(pathname = '') {
  const parts = pathname.split('/')
  const lastPart = parts[parts.length - 1] || ''
  return /\.[a-zA-Z0-9]+$/.test(lastPart)
}

function shouldUseSpaFallback(pathname, spaConfig = {}) {
  if (!spaConfig?.enabled) return false
  if (!pathname) return false
  const normalizedPath = normalizePath(pathname)
  const excludePrefixes = spaConfig.excludePrefixes || []
  for (const prefix of excludePrefixes) {
    const normalizedPrefix = normalizePath(prefix)
    if (normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)) {
      return false
    }
  }
  if (spaConfig.excludeExtensions && hasFileExtension(normalizedPath)) return false
  return true
}


function sanityCheckRootDir(rootDir, externalRootDir = false) {
  if (!externalRootDir && !rootDir.startsWith(process.cwd())) {
    throw new Error(`rootDir is not inside process.cwd(): "${rootDir}"`)
  }

  if (externalRootDir) {
    logger.warn(`Potentially unsafe! "externalRootDir" is enabled for rootDir: "${rootDir}"`)
  }

  if (!fs.existsSync(rootDir)) {
    throw new Error(`rootDir does not exist: "${rootDir}"`)
  }

  return true
}

function simpleSecurityCheck(url, preventSystemFileAccess = true) {
  const lowerUrl = String(url || '').toLowerCase()
  const pathname = getPathnameFromUrl(lowerUrl)
  const segments = pathname.split('/').filter(Boolean)
  const systemSegments = new Set(['etc', 'boot', 'lib', 'bin', 'sbin', 'usr', 'var'])

  if (URL_PATH_DANGEROUS_CTRL_RE.test(String(url || ''))
    || lowerUrl.includes('..') // prevent path traversal
    || segments.some(segment => segment.startsWith('.')) // prevent access to hidden files/directories
    || lowerUrl.includes('%2e%2e') // prevent encoded path traversal ".."
    || lowerUrl.includes('%2e') // prevent encoded dot
    || lowerUrl.includes('\\') // prevent backslash
    || lowerUrl.includes('%5c') // prevent encoded double-backslash
    || lowerUrl.includes('%2f') // prevent encoded forward slash
    || (preventSystemFileAccess && segments.some(segment => systemSegments.has(segment)))
  ) throw new HttpError(403, 'url contains invalid characters')
  else   return true
}

/**
 * Allowed directory roots for resolved file paths (slice B + Soundclone): includes `rootDir` and
 * every directory that contains a mapped file, including paths outside `rootDir` when fileMap
 * uses `..` (e.g. `../data`) or absolute targets.
 */
function addPathToAllowedServeRoots(roots, fsPath) {
  if (!fsPath) return
  const abs = path.resolve(fsPath)
  try {
    if (fs.existsSync(abs)) {
      const st = fs.statSync(abs)
      if (st.isDirectory()) {
        roots.add(abs)
      } else {
        roots.add(path.resolve(path.dirname(abs)))
      }
    } else {
      roots.add(path.resolve(path.dirname(abs)))
    }
  } catch {
    roots.add(path.resolve(path.dirname(abs)))
  }
}

function buildAllowedStaticServeRootDirs(quickLookup, catchAllFallbackPath, spaEntryPath, rootDir) {
  const roots = new Set()
  addPathToAllowedServeRoots(roots, rootDir)
  for (const fp of Object.values(quickLookup)) {
    addPathToAllowedServeRoots(roots, fp)
  }
  if (catchAllFallbackPath) {
    addPathToAllowedServeRoots(roots, catchAllFallbackPath)
  }
  if (spaEntryPath) {
    addPathToAllowedServeRoots(roots, spaEntryPath)
  }
  return roots
}

function isPathUnderAllowedServeRoots(resolvedFile, allowedDirRoots) {
  const abs = path.resolve(resolvedFile)
  for (const r of allowedDirRoots) {
    if (isPathUnderRoot(abs, r)) {
      return true
    }
  }
  return false
}

function getLastModified(filePath) {
  const stats = fs.statSync(filePath)

  return stats.mtime.toISOString() // modification time
    || stats.ctime.toISOString() // change time
    || stats.birthtime.toISOString() // creation time
}

const prettyPrintQuickLookup = (quickLookup) => {
  let prettyString = '\n'
  for (let url in quickLookup) {
    prettyString += `  ${url} → ${path.relative(process.cwd(), quickLookup[url])}\n`
  }
  return prettyString
}


async function getRangeData(filePath, range) {
  // TODO promise
  const fileSize = fs.statSync(filePath).size
  const parts = range.replace(/bytes=/, "").split("-")
  const start = parseInt(parts[0], 10)
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
  
  // Validate range
  if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
    return { invalid: true, fileSize }
  }
  
  const chunksize = (end - start) + 1
  return { start, end, chunksize, fileSize, invalid: false }
}

// TODO dev mode default returns quickLookup path urls
const $404 = () => new HttpError(404, 'Not found')

export default async function createStaticFileService({
  serviceName = 'static-files',
  rootDir = normalizePath(process.cwd()),
  urlRoot = '/',
  fileMap = 'index.html',
  externalRootDir = false,
  customSecurityCheck = null,
  simpleSecurity = true,
  preventSystemFileAccess = true,
  spa = null,
  useAuthService = null,
  autoRefresh = false  // NEW: false | { mode, ...options }
}, resolverFn, defaultFn = $404) {
  let logger = new Logger({ logGroup: serviceName })

  if (!externalRootDir && !rootDir.startsWith(process.cwd())) {
    // assume this is a relative path
    rootDir = path.join(normalizePath(process.cwd()), rootDir)
  }

  sanityCheckRootDir(rootDir, externalRootDir)

  if (typeof fileMap === 'string') {
    // if just a string is provided, assume this is our index path
    fileMap = { '/' : fileMap }
  }

  const legacyCatchAllConfigured = Object.prototype.hasOwnProperty.call(fileMap, '/*')
  const spaEnabled = !!spa
  if (spaEnabled && legacyCatchAllConfigured) {
    logger.warn('SPA mode is enabled while fileMap contains "/*". SPA mode takes precedence and catch-all route is deprecated.')
  }

  const spaConfig = {
    enabled: spaEnabled,
    entryPath: null,
    excludePrefixes: [],
    excludeExtensions: true
  }
  if (spaEnabled) {
    const spaInput = typeof spa === 'object' ? spa : {}
    spaConfig.entryPath = targetToFsPath(rootDir, normalizePath(spaInput.entry || 'index.html'))
    spaConfig.excludePrefixes = Array.isArray(spaInput.excludePrefixes)
      ? spaInput.excludePrefixes.map(normalizePath)
      : []
    spaConfig.excludeExtensions = spaInput.excludeExtensions !== false
    if (!fs.existsSync(spaConfig.entryPath)) {
      throw new Error(`spa.entry file does not exist: "${spaInput.entry || 'index.html'}"`)
    }
  }

  let { quickLookup, catchAllFallbackPath } = generateQuickLookupMap(fileMap, urlRoot, rootDir)
  logger.info(`Static files mapped for "${urlRoot}" ${prettyPrintQuickLookup(quickLookup)}${catchAllFallbackPath ? ` (catch-all: ${path.relative(process.cwd(), catchAllFallbackPath)})` : ''}`)

  let allowedStaticServeRootDirs = buildAllowedStaticServeRootDirs(
    quickLookup,
    catchAllFallbackPath,
    spaConfig.enabled ? spaConfig.entryPath : null,
    rootDir
  )
  const syncAllowedStaticServeRoots = () => {
    allowedStaticServeRootDirs = buildAllowedStaticServeRootDirs(
      quickLookup,
      catchAllFallbackPath,
      spaConfig.enabled ? spaConfig.entryPath : null,
      rootDir
    )
  }
  
  // Auto-refresh state tracking
  let refreshStats = {
    lastRefresh: Date.now(),
    totalFiles: Object.keys(quickLookup).length,
    refreshCount: 0,
    mode: autoRefresh ? (autoRefresh.mode || 'manual') : 'manual'
  }
  let refreshInterval = null
  let isPaused = false

  function resolveFilePath(url) {
    const pathname = getPathnameFromUrl(url)
    const normalizedUrl = normalizePath(pathname)
    let filePath = quickLookup[normalizedUrl]

    if (!filePath && spaConfig.enabled && shouldUseSpaFallback(normalizedUrl, spaConfig)) {
      filePath = spaConfig.entryPath
      logger.debug(`using spa fallback for url: "${url}"`)
    } else if (!filePath && catchAllFallbackPath) {
      filePath = catchAllFallbackPath
      logger.debug(`using catch-all fallback for url: "${url}"`)
    }

    return { filePath, normalizedUrl }
  }

  async function getLocalFile(url) {
    const { filePath } = resolveFilePath(url)

    if (!filePath) {
      logger.debug(`file not found in lookup for url: "${url}"`)
      throw new HttpError(404, 'Not found')
    }

    const absRead = path.resolve(filePath)
    if (!isPathUnderAllowedServeRoots(absRead, allowedStaticServeRootDirs)) {
      throw new HttpError(403, 'path not under allowed static roots')
    }

    return await fsAsync.readFile(filePath)
  }
  
  async function getFile(payload, request, response) {
    // TODO shouldn't get here if the publish headers are correct
    //   context call from upload service may be wrong
    const url = payload?.url || request?.url
    logger.debug(`getting file for url: "${url}"`)

    if (simpleSecurity) simpleSecurityCheck(url, preventSystemFileAccess)
    else logger.warn('simpleSecurity is disabled, make sure you trust the source of the url, or implement customSecurityCheck')

    if (customSecurityCheck) customSecurityCheck(url)
    else if (!simpleSecurity) logger.warn('customSecurityCheck is disabled, make sure you trust the source of the url, or use simpleSecurity')

    if (!url) throw new HttpError(400, 'url is required')

    const { filePath } = resolveFilePath(url)

    // TODO optional eager lookup of file path before resolver
    // eager lookup should also update quickLookup if it's not already present
    // quickLookup should have the option to be backed up by a cache service with eviction


    if (!filePath) {
      logger.debug(`file not found in lookup for url: "${url}"`)
      if (resolverFn) {
        try {

          let suggestedContentType = detectContentType(null, url)
          logger.debug('staticFileService - suggestedContentType:', suggestedContentType)
          response.setHeader('content-type', suggestedContentType)

          // TODO needed?
          const setContentType = (contentType) => {
            response.setHeader('content-type', contentType)
          }

          let result = await resolverFn(url, setContentType)

          // TODO should actually complete read file?
          if (result !== false && result != null) return result
        } catch (err) {
          logger.debugErr(`Error in static file resolver at "${url}":`, err)
          throw err
        }
      }

      logger.debug(`file failed to resolve for url: "${url}"; using defaultFn`)
      let defaultResult = await defaultFn()
      if (defaultResult instanceof Error) {
        throw defaultResult
      } else {
        return defaultResult
      }
    }

    const absServe = path.resolve(filePath)
    if (!isPathUnderAllowedServeRoots(absServe, allowedStaticServeRootDirs)) {
      throw new HttpError(403, 'path not under allowed static roots')
    }

    logger.debug('staticFileService - filePath:', filePath)
    let contentType = detectContentType(null, filePath)

    const isLocalHelperCall = !response
    if (isLocalHelperCall) return fs.createReadStream(filePath)
    else {
      const fileStats = fs.statSync(filePath)
      const fileSize = fileStats.size
      
      // Always advertise range support for all files
      response.setHeader('accept-ranges', 'bytes')
      response.setHeader('content-type', contentType)
      response.setHeader('last-modified', getLastModified(filePath))

      // Handle range requests
      if (request?.headers?.range) {
        // Check If-Range precondition (RFC 7233)
        // If-Range can be either an ETag or a date (Last-Modified)
        const ifRange = request.headers['if-range']
        let shouldProcessRange = true
        
        if (ifRange) {
          const lastModified = getLastModified(filePath)
          // Simple date comparison - if file was modified, ignore range and send full file
          if (ifRange !== lastModified) {
            shouldProcessRange = false
            logger.debug('If-Range condition failed, sending full file')
          }
        }
        
        if (shouldProcessRange) {
          const rangeData = await getRangeData(filePath, request.headers.range)
          
          // Handle invalid range (416 Range Not Satisfiable)
          if (rangeData.invalid) {
            response.setHeader('content-range', `bytes */${rangeData.fileSize}`)
            response.writeHead(416)
            response.end()
            return next({ reason: 'invalid range', file: filePath })
          }
          
          // Valid range - send partial content (206)
          const { start, end, chunksize } = rangeData
          response.setHeader('content-range', `bytes ${start}-${end}/${fileSize}`)
          response.setHeader('content-length', chunksize)
          response.writeHead(206)
          fs.createReadStream(filePath, { start, end }).pipe(response)
        } else {
          // If-Range condition failed - send full file
          response.setHeader('content-length', fileSize)
          response.writeHead(200)
          fs.createReadStream(filePath).pipe(response)
        }
      } else {
        // Normal request - send full file (200)
        response.setHeader('content-length', fileSize)
        response.writeHead(200)
        fs.createReadStream(filePath).pipe(response)
      }

      // TODO return next()? preventDefault()? next({ preventDefault: true })?
      return next({ reason: 'streaming file', file: filePath })
    }
  }


  // --- Auto-refresh functionality ---------------------------------------------
  
  /**
   * Add a single file to the index
   * @param {string} urlPath - URL path (e.g. '/uploads/photo.jpg')
   * @param {string} filePath - Full filesystem path
   */
  function addFile(urlPath, filePath) {
    // For now, protect against overwriting root if there is no path
    if (!urlPath) throw new Error('No urlPath to update')

    // TODO should determine urlPath based on filePath
    urlPath = normalizePath(urlPath)
    
    // Security check
    // TODO whitelist other directories
    // if (!filePath.startsWith(rootDir)) {
    //   logger.warn(`Rejecting file outside rootDir: ${filePath}`)
    //   return false
    // }
    
    if (!fs.existsSync(filePath)) {
      logger.warn(`Attempting to add non-existent file: ${filePath}`)
      return false
    }
    
    quickLookup[urlPath] = filePath
    refreshStats.totalFiles = Object.keys(quickLookup).length
    syncAllowedStaticServeRoots()
    
    if (autoRefresh?.onFileAdded) {
      autoRefresh.onFileAdded({ urlPath, filePath })
    }
    
    return true
  }
  
  /**
   * Remove a file from the index
   * @param {string} urlPath - URL path to remove
   */
  function removeFile(urlPath) {
    urlPath = normalizePath(urlPath)
    
    if (quickLookup[urlPath]) {
      delete quickLookup[urlPath]
      refreshStats.totalFiles = Object.keys(quickLookup).length
      
      if (autoRefresh?.onFileRemoved) {
        autoRefresh.onFileRemoved({ urlPath })
      }
      
      return true
    }
    
    return false
  }
  
  /**
   * Refresh a specific directory path
   * @param {string} dirPath - Directory path to rescan
   */
  async function refreshPath(dirPath) {
    const startTime = Date.now()
    let addedCount = 0
    let removedCount = 0
    
    // Find matching fileMap entry
    for (let urlRoute in fileMap) {
      let target = fileMap[urlRoute]
      
      if (target.endsWith('/*')) {
        target = target.slice(0, -2)
      }
      
      const fullTargetPath = path.join(rootDir, target)
      const fullDirPath = path.join(rootDir, dirPath)
      
      // Check if this is the directory we want to refresh
      if (fullDirPath.startsWith(fullTargetPath)) {
        // Regenerate for this specific mapping
        const oldUrls = new Set()
        const urlPrefix = urlRoute.endsWith('/*') ? urlRoute.slice(0, -2) : urlRoute
        
        // Track existing URLs for this path
        for (const url in quickLookup) {
          if (url.startsWith(urlPrefix)) {
            oldUrls.add(url)
          }
        }
        
        // Rescan directory
        try {
          populateQuickLookupForDirectoryTree(quickLookup, rootDir, urlPrefix, target)
          
          // Count additions
          for (const url in quickLookup) {
            if (url.startsWith(urlPrefix) && !oldUrls.has(url)) {
              addedCount++
            }
          }
          
          // Handle deletions if enabled
          if (autoRefresh?.detectDeletions) {
            for (const url of oldUrls) {
              if (!quickLookup[url]) {
                removedCount++
              }
            }
          }
        } catch (err) {
          logger.error(`Error refreshing path ${dirPath}:`, err)
          throw err
        }
        syncAllowedStaticServeRoots()
      }
    }
    
    const duration = Date.now() - startTime
    refreshStats.totalFiles = Object.keys(quickLookup).length
    
    logger.debug(`Refreshed path ${dirPath}: +${addedCount} -${removedCount} (${duration}ms)`)
    
    return { added: addedCount, removed: removedCount, duration }
  }
  
  /**
   * Full index refresh - rescan all directories
   */
  async function refreshIndex() {
    const startTime = Date.now()
    
    try {
      const oldLookup = { ...quickLookup }
      const result = generateQuickLookupMap(fileMap, urlRoot, rootDir)
      for (const k of Object.keys(quickLookup)) delete quickLookup[k]
      for (const k in result.quickLookup) quickLookup[k] = result.quickLookup[k]
      catchAllFallbackPath = result.catchAllFallbackPath
      syncAllowedStaticServeRoots()
      
      // Calculate changes
      const oldUrls = new Set(Object.keys(oldLookup))
      const newUrls = new Set(Object.keys(quickLookup))
      
      const added = [...newUrls].filter(url => !oldUrls.has(url))
      const removed = [...oldUrls].filter(url => !newUrls.has(url))
      
      const duration = Date.now() - startTime
      refreshStats.lastRefresh = Date.now()
      refreshStats.totalFiles = Object.keys(quickLookup).length
      refreshStats.refreshCount++
      
      logger.debug(`Index refreshed: +${added.length} -${removed.length} files (${duration}ms)`)
      
      if (autoRefresh?.onRefreshComplete) {
        autoRefresh.onRefreshComplete({ 
          added: added.length, 
          removed: removed.length, 
          duration,
          total: refreshStats.totalFiles
        })
      }
      
      return { 
        added: added.length, 
        removed: removed.length, 
        duration,
        addedFiles: added,
        removedFiles: removed
      }
    } catch (err) {
      logger.error('Error refreshing index:', err)
      if (autoRefresh?.onRefreshError) {
        autoRefresh.onRefreshError(err)
      }
      throw err
    }
  }
  
  /**
   * Get index statistics
   */
  function getIndexStats() {
    return {
      ...refreshStats,
      isPaused,
      hasInterval: !!refreshInterval
    }
  }
  
  /**
   * Pause auto-refresh (interval mode)
   */
  function pauseAutoRefresh() {
    isPaused = true
  }
  
  /**
   * Resume auto-refresh (interval mode)
   */
  function resumeAutoRefresh() {
    isPaused = false
  }
  
  /**
   * Handle file upload event from pubsub
   */
  async function handleFileUploadEvent(event) {
    logger.debug('staticFileService - handleFileUploadEvent:', event)
    try {
      const { urlPath, filePath } = event
      addFile(urlPath, filePath)
    } catch (err) {
      logger.error('Error handling file upload event:', err)
    }
  }
  
  /**
   * Handle file deletion event from pubsub
   */
  async function handleFileDeletionEvent(event) {
    logger.debug('staticFileService - handleFileUploadEvent:', event)
    try {
      const { urlPath } = event
      removeFile(urlPath)
    } catch (err) {
      logger.error('Error handling file deletion event:', err)
    }
  }
  
  // --- create service and helpers to expose ---------------------------------
  const server = await createService(serviceName, getFile, { useAuthService })

  // Attach lookup map and helper functions
  server.quickLookup = quickLookup
  server.getFile = getLocalFile
  server.refreshIndex = refreshIndex
  server.refreshPath = refreshPath
  server.addFile = addFile
  server.removeFile = removeFile
  server.getIndexStats = getIndexStats
  server.pauseAutoRefresh = pauseAutoRefresh
  server.resumeAutoRefresh = resumeAutoRefresh
  
  // --- Setup auto-refresh based on mode -------------------------------------
  let subscriptionService = null
  if (autoRefresh && autoRefresh.mode) {
    const mode = autoRefresh.mode
    const updateChannel = autoRefresh.updateChannel || 'yamf:file-updated'
    const deletionChannel = autoRefresh.deletionChannel || 'yamf:file-deleted'
    const intervalMs = autoRefresh.intervalMs || 10000
    
    logger.info(`Auto-refresh enabled: mode=${mode}`)
    
    // PubSub mode - subscribe to file upload/deletion events
    if (mode === 'pubsub' || mode === 'hybrid') {
      try {
        subscriptionService = await createSubscriptionService(`${serviceName}-autorefresh`, {
          [updateChannel]: handleFileUploadEvent,
          [deletionChannel]: handleFileDeletionEvent
        })
        logger.info(`Auto-refresh subscribed to: ${updateChannel}, ${deletionChannel}`)
      } catch (err) {
        logger.error('Failed to subscribe to file events:', err)
      }
    }
    
    // Interval mode - periodic directory scanning
    if (mode === 'interval' || mode === 'hybrid') {
      refreshInterval = setInterval(async () => {
        if (isPaused) {
          logger.debug('Skipping refresh (paused)')
          return
        }
        
        try {
          await refreshIndex()
        } catch (err) {
          logger.error('Error in scheduled refresh:', err)
        }
      }, intervalMs)
      
      logger.info(`Interval refresh started: ${intervalMs}ms`)
    }
  }

  // Override terminate to cleanup intervals and subscriptions
  let originalTerminate = server.terminate.bind(server)
  server.terminate = async () => {
    // Clear refresh interval
    if (refreshInterval) {
      clearInterval(refreshInterval)
      refreshInterval = null
    }
    
    if (subscriptionService) {
      await subscriptionService.terminate()
    }
    
    await originalTerminate()
  }

  return server
}
