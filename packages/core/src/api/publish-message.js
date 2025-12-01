import httpRequest from '../http-primitives/http-request.js'
import { buildPublishHeaders } from '../shared/yamf-headers.js'
import envConfig from '../shared/env-config.js'
import HttpError from '../http-primitives/http-error.js'
import Logger from '../utils/logger.js'

const logger = new Logger({ logGroup: 'yamf-api' })

/**
 * Publish a message to a pubsub channel via the registry
 * 
 * @param {string} channel - The channel name to publish to
 * @param {any} message - The message payload to send
 * @returns {Promise<{results: Array, errors: Array}>} Results and errors from all subscribers
 */
export default async function publishMessage(channel, message) {
  let registryHost = process.env.YAMF_REGISTRY_URL
  if (!registryHost) throw new Error('Please define "YAMF_REGISTRY_URL" env variable')
  
  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')
    
  let result = await httpRequest(registryHost, {
    body: message,
    headers: buildPublishHeaders(channel, registryToken)
  })
  
  return result
}

export async function publishMessageWithCache(cache, channel, message) { // TODO consistent naming
  // name could be the function if called "locally", or a noop of the same name for code-completion
  // channel = name.name || name
  let registryHost = process.env.YAMF_REGISTRY_URL

  const registryToken = envConfig.get('YAMF_REGISTRY_TOKEN')

  logger.debug('cache.subscriptions', cache.subscriptions)

  if (!cache.subscriptions[channel]) throw new HttpError(404, `No subscription by name "${channel}" in cache`)
  let locations = cache.subscriptions[channel].map(s => s)

  let results = []
  for (let location of locations) {
    // TODO currently the subscription cache is locations, not services
    // need to consider cleaning up createSubscriptionService to result in a singular cache update
    // including the subscription channel, subscribing service name, and its location

    // let addresses = cache.services[service].map(s => s)
    // let len = addresses.length

    // TODO implement strategies (random, round-robin, etc.)
    // initialize service round-robin start index based on own location port number

    // let ind = Math.floor(Math.random() * len)
    // let location = addresses[ind]

    results.push(await httpRequest(location, {
      body: message,
      headers: buildPublishHeaders(channel, registryToken)
    }))
  }
  
  return results
}
