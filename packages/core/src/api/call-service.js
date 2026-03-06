import httpRequest from '../http-primitives/http-request.js'
import HttpError from '../http-primitives/http-error.js'
import envConfig from '../shared/env-config.js'
import { buildCallHeaders } from '../shared/yamf-headers.js'
import Logger from '../utils/logger.js'
import { getLocalService, hasLocalService } from '../shared/local-state.js'
import { validatePayloadAgainstContract } from '../service/service-contract.js'

const logger = new Logger({ logGroup: 'yamf-api' })

export default async function callService (name, payload, {
  contentType = 'application/json',
  authToken = null
} = {}) {
  let registryHost = envConfig.getRequired('YAMF_REGISTRY_URL')

  let customHeaders
  if (payload?.body && payload?.headers) {
    logger.debug(`callService ${name} using custom headers`)
    customHeaders = payload.headers
    payload = payload.body
  }
  
  logger.debug('callService - name:', name)
  let headers = buildCallHeaders(name, authToken)

  if (customHeaders) headers = Object.assign(headers, customHeaders)
  else headers['content-type'] = contentType
  
  let result = await httpRequest(registryHost, {
    body: payload,
    headers
  })
  
  return result
}

export async function callServiceWithCache (cache, name, payload) {
  // name could be the function if called "locally", or a noop of the same name for code-completion
  name = name.name || name

  // Check if service exists in cache
  if (!cache.services.has(name)) {
    throw new HttpError(404, `No service by name "${name}" in cache`)
  }

  // Validate payload against contract if the target service opted in
  const contract = cache.serviceContracts?.get(name)
  if (contract?.enforce) {
    await validatePayloadAgainstContract(name, payload, contract)
  }
  
  let result
  
  // Short-circuit for local (same node thread) call
  const localService = getLocalService(name)
  if (localService) {
    logger.debug(`short-circuiting network call - service is in same node thread: ${name}`)
    result = await localService(payload)
  } else {
    // Check if this is a pure/local service on another node (marked as 'external')
    const accessControl = cache.serviceAccess.get(name)
    if (accessControl === 'external') {
      throw new HttpError(403,
        `Service "${name}" is a pure/local service on another node and cannot be called from here. ` +
        `If cross-node calls are needed, change the service to use 'private' access control.`
      )
    }

    // Get service locations from cache
    const locations = cache.services.get(name)
    if (!locations || locations.size === 0) {
      throw new HttpError(404, `No locations for service "${name}"`)
    }
    
    const addresses = Array.from(locations)
    const len = addresses.length

    // TODO implement strategies (random, round-robin, etc.)
    // For now: random selection
    const ind = Math.floor(Math.random() * len)
    const location = addresses[ind]

    logger.debug(`making network call - service is not local: ${name}`)
    
    result = await httpRequest(location, { body: payload })
  }

  return result
}
