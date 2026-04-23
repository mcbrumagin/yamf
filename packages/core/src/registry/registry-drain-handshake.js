/**
 * Before binding the registry HTTP port, ask the current peer (YAMF_REGISTRY_URL) to enter drain.
 */

import { randomUUID } from 'node:crypto'
import Logger from '../utils/logger.js'
import envConfig from '../shared/env-config.js'
import { COMMANDS, HEADERS } from '../shared/yamf-headers.js'

const logger = new Logger({ logGroup: 'yamf-registry' })

export function assignRegistryInstanceId(state) {
  if (!state.registryInstanceId) {
    state.registryInstanceId = randomUUID()
  }
  return state.registryInstanceId
}

/**
 * POST REGISTRY_DRAIN to YAMF_REGISTRY_URL before this instance listens.
 * Failure (refused, timeout) = first/only registry; 400 = loopback self; 200 = peer will drain.
 */
export async function performRegistryDrainHandshake(state) {
  const myId = assignRegistryInstanceId(state)
  const registryUrl = envConfig.get('YAMF_REGISTRY_URL')
  if (!registryUrl) {
    return
  }

  const token = envConfig.get('YAMF_REGISTRY_TOKEN')
  const headers = {
    'content-type': 'application/json',
    [HEADERS.COMMAND]: COMMANDS.REGISTRY_DRAIN,
    [HEADERS.REGISTRY_INSTANCE_ID]: myId,
    ...(token && { [HEADERS.REGISTRY_TOKEN]: token })
  }

  const timeoutMs = Number(envConfig.get('YAMF_REGISTRY_DRAIN_HANDSHAKE_MS', 8000))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(registryUrl, {
      method: 'POST',
      headers,
      body: '{}',
      signal: controller.signal
    })

    if (res.status === 400) {
      logger.debug('REGISTRY_DRAIN: peer returned 400 (treat as first registry or self)')
      return
    }
    if (res.status === 200) {
      const peer = res.headers.get(HEADERS.REGISTRY_INSTANCE_ID) || res.headers.get(HEADERS.REGISTRY_INSTANCE_ID.toLowerCase())
      logger.info(`REGISTRY_DRAIN: peer accepted drain (instance ${peer || 'unknown'})`)
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.debug('REGISTRY_DRAIN: handshake timeout — proceeding as first registry')
    } else {
      logger.debug(`REGISTRY_DRAIN: no peer or error (${err.code || err.message}) — first registry`)
    }
  } finally {
    clearTimeout(timer)
  }
}
