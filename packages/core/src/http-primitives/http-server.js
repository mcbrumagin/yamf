import http from 'node:http'
import readStream from './read-stream.js'
import HttpError from './http-error.js'
import Logger from '../utils/logger.js'
import fs from 'node:fs'
import { detectContentType } from './content-type-detector.js'
import { getDefaultResponseSecurityHeaders } from '../shared/csp.js'

const logger = new Logger({ logGroup: 'http-primitives' })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function prependServiceNameToErrorStack(err, serviceName) {
  // helpful for cascading errors

  let errFrags = err.stack.split('\n')
  errFrags.splice(1, 0, `in service "${serviceName}"`)
  err.stack = errFrags.join('\n')
}

/**
 * Guard response methods so double-send logs a warning instead of throwing (e.g. user onSuccess + framework).
 * @param {import('http').ServerResponse} response
 * @param {{ name?: string, port?: number }} ctx
 */
function overrideResponse (response, ctx = { name: 'http-server', port: 0 }) {
  response.isEnded = false
  const originalEnd = response.end.bind(response)
  const originalWriteHead = response.writeHead.bind(response)
  const originalSetHeader = response.setHeader.bind(response)

  const warnDouble = (what) => {
    logger.warn(`${what} after response ended or headers sent`, { port: ctx.port, name: ctx.name })
  }

  response.writeHead = function writeHeadGuard (...args) {
    if (response.writableEnded || response.headersSent) {
      warnDouble('writeHead')
      return response
    }
    return originalWriteHead.apply(response, args)
  }

  response.setHeader = function setHeaderGuard (name, value) {
    if (response.writableEnded || response.headersSent) {
      warnDouble('setHeader')
      return
    }
    return originalSetHeader.call(response, name, value)
  }

  response.end = (sanitizedPayload) => {
    if (!Buffer.isBuffer(sanitizedPayload) && typeof sanitizedPayload === 'object' && sanitizedPayload != null) {
      sanitizedPayload = JSON.stringify(sanitizedPayload)
    }

    if (!response.isEnded && !response.writableEnded) {
      originalEnd.call(response, sanitizedPayload)
    } else {
      warnDouble('end')
    }
    response.isEnded = true
  }
  return response
}

export default async function createServer(port, serverFn, options = {}) {
  if (!port) throw new Error('"port" is required')
  if (!serverFn) throw new Error('"serverFn" is required')

  const { streamPayload = false, csp: cspOverride = null, frameOptions } = options
  const requestTimeout = options.requestTimeout !== undefined ? options.requestTimeout : 60000
  const headersTimeout = options.headersTimeout !== undefined ? options.headersTimeout : 30000
  const securityHeaders = getDefaultResponseSecurityHeaders({
    csp: cspOverride,
    frameOptions
  })

  return new Promise((resolve, reject) => {
    const server = http.createServer({
      keepAlive: true,
      keepAliveInitialDelay: 0,
      requestTimeout,
      headersTimeout: Math.min(headersTimeout, requestTimeout || Infinity),
    }, async (request, response) => {
      // Response methods are wrapped to avoid process crash on double-send (see overrideResponse).
      response = overrideResponse(response, { name: serverFn.name, port })
      try {
        let body
        const contentType = request.headers['content-type'] || ''
        const method = request.method.toUpperCase()
        
        // Methods that should not have a body
        const methodsWithoutBody = ['GET', 'HEAD', 'DELETE', 'OPTIONS']
        
        // Auto-detect if we should stream based on content-type (for multipart uploads)
        const shouldStream = streamPayload || contentType.includes('multipart/')
        
        // If method doesn't support body, pass empty object for service compatibility
        if (methodsWithoutBody.includes(method)) {
          body = {}
        } else if (shouldStream) {
          body = null
        } else {
          body = await readStream(request)

          // Determine if we should parse as JSON based on content-type
          // Binary content types should NOT be parsed as JSON
          const isBinaryContent = contentType.includes('octet-stream')
              || contentType.includes('audio/')
              || contentType.includes('video/')
              || contentType.includes('image/')
          
          // Parse body as JSON if it's not binary
          if (!isBinaryContent && body && body.length > 0) {
            try { 
              // Convert buffer to string, then parse as JSON
              const bodyStr = Buffer.isBuffer(body) ? body.toString('utf8') : body
              body = JSON.parse(bodyStr)
            } catch (err) { 
              // If JSON parsing fails, keep as-is (could be plain text or buffer)
            }
          }
        }
        
        let result = await server.handler(body, request, response)
        if (result instanceof fs.ReadStream) {
          return result.pipe(response) // TODO VERIFY THIS WORKS
        } else if (result !== false) {
          // Determine content type and body based on result type
          let contentType = 'application/json'
          let responseBody = result
          
          if (Buffer.isBuffer(result)) {
            // Binary data - send as-is unless a content-type is explicitly set
            contentType = response.getHeader('content-type') || 'application/octet-stream'
            responseBody = result
          } else if (typeof result === 'string') {
            // Strings - detect if HTML, XML, JSON, or plain text
            if (!response.getHeader('content-type')) {
              contentType = detectContentType(result, request.url)
            }
            responseBody = result
          } else {
            // Everything else (objects, arrays, numbers, booleans, null) - send as JSON
            // This preserves type information (numbers stay numbers, booleans stay booleans, etc.)
            contentType = 'application/json'
            responseBody = JSON.stringify(result)
          }
          
          response.writeHead(200, {
            'content-type': contentType,
            ...securityHeaders
          })
          response.end(responseBody)
        } // else logger.warn('nothing returned from server handler', {port, name: serverFn.name})
      } catch (err) {
        if (err instanceof HttpError) {
          prependServiceNameToErrorStack(err, serverFn.name)
          // response.setHeader('x-correlation-id', generateId()) // TODO?
          if (!response.writableEnded) {
            for (const [hk, hv] of Object.entries(securityHeaders)) {
              response.setHeader(hk, hv)
            }
            response.setHeader('content-type', 'text/plain')
            response.writeHead(err.status || 500)
            response.end(err.stack)
          } else {
            logger.warn('response already ended', {port, name: serverFn.name})
            logger.error(err.stack)
          }
        } else {
          if (!response.writableEnded) {
            for (const [hk, hv] of Object.entries(securityHeaders)) {
              response.setHeader(hk, hv)
            }
            response.setHeader('content-type', 'text/plain')
            response.writeHead(500)
            response.end(err.stack)
          } else {
            logger.warn('response already ended', {port, name: serverFn.name})
            logger.error(err.stack)
          }
        }
      }
    })

    // store our handler so we can override w/ "middleware"
    server.handler = serverFn

    server.on('error', err => {
      logger.warn(`server "${serverFn.name}" failed to start at port ${port}`)
      // logger.warn(err.stack)
      reject(err)
    })

    server.terminate = () => new Promise(resolve => {
      server.on('close', async () => {
        // I hate this, but for some reason, in tests,
        // terminating and restarting causes subsequent create-service registrations to fail.
        // This should permit whatever outlying OS network freeing outside nodejs
        await sleep(5) // TODO
        // not having sleep currently only fails testRouteMissingService
        resolve()
      })
      server.close()
    })
    
    server.listen(port, () => {
      server.port = port
      server.name = serverFn.name
      logger.debug(`server "${serverFn.name}" listening on ${port}`)
      resolve(server)
    })
  })
}
