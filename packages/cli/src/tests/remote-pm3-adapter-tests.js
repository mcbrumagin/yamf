/**
 * API-style tests for {@link import('../lib/remote-pm3-adapter.js')}: pm3-service wire shape over
 * registry SERVICE_CALL (no live registry / pm3-service required — fetch is mocked).
 */
import { assert, withEnv } from '@yamf/test'
import { HEADERS, COMMANDS } from '@yamf/core'
import {
  createRemotePm3,
  createRemotePm3Cli,
  requireRegistryUrlForRemote
} from '../lib/remote-pm3-adapter.js'

function jsonResponse (obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(obj),
    json: async () => obj
  }
}

function parseBody (options) {
  const b = options?.body
  if (b == null) return null
  if (typeof b === 'string') {
    try {
      return JSON.parse(b)
    } catch {
      return b
    }
  }
  return b
}

export async function testCreateRemotePm3StartSendsDeployCommandWithDeployToken () {
  const registryUrl = 'http://registry.test'
  let captured = null
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    captured = { url, options }
    return jsonResponse({ ok: true })
  }
  try {
    const remote = createRemotePm3({
      registryUrl,
      registryToken: 'reg-tok',
      deployToken: 'dep-tok'
    })
    await remote.start('/remote/path/bundle.mjs', {
      env: {
        YAMF_SERVICE_NAME: 'my-svc',
        YAMF_SOURCE_HASH: 'sha256-abc',
        YAMF_BUNDLE_PATH: '/remote/path/bundle.mjs',
        FOO: 'bar'
      }
    })
    await assert(captured?.url, (u) => u === registryUrl)
    await assert(captured?.options?.method, (m) => m === 'POST')
    const h = captured?.options?.headers || {}
    await assert(h[HEADERS.COMMAND], (v) => v === COMMANDS.SERVICE_CALL)
    await assert(h[HEADERS.SERVICE_NAME], (v) => v === 'pm3-service')
    await assert(h[HEADERS.REGISTRY_TOKEN], (v) => v === 'reg-tok')
    await assert(h[HEADERS.DEPLOY_TOKEN], (v) => v === 'dep-tok')
    const body = parseBody(captured?.options)
    await assert(body?.command, (c) => c === 'deploy')
    await assert(body?.service, (s) => s === 'my-svc')
    await assert(body?.hash, (hsh) => hsh === 'sha256-abc')
    await assert(body?.env?.YAMF_BUNDLE_PATH, (p) => p === '/remote/path/bundle.mjs')
  } finally {
    global.fetch = originalFetch
  }
}

export async function testCreateRemotePm3RestartRollingSendsRollingDeployCommand () {
  const registryUrl = 'http://registry.test'
  let captured = null
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    captured = { url, options }
    return jsonResponse({ ok: true, replaced: [] })
  }
  try {
    const remote = createRemotePm3({
      registryUrl,
      deployToken: 'dep-tok'
    })
    await remote.restartRolling('my-svc', {
      env: { YAMF_SOURCE_HASH: 'sha256-xyz', YAMF_BUNDLE_PATH: '/b.mjs' }
    })
    const h = captured?.options?.headers || {}
    await assert(h[HEADERS.DEPLOY_TOKEN], (v) => v === 'dep-tok')
    const body = parseBody(captured?.options)
    await assert(body?.command, (c) => c === 'rolling-deploy')
    await assert(body?.service, (s) => s === 'my-svc')
    await assert(body?.hash, (hsh) => hsh === 'sha256-xyz')
  } finally {
    global.fetch = originalFetch
  }
}

export async function testCreateRemotePm3CliListDoesNotSetDeployToken () {
  const registryUrl = 'http://registry.test'
  let captured = null
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    captured = { url, options }
    return jsonResponse({ processes: [] })
  }
  try {
    const cli = createRemotePm3Cli({ registryUrl, registryToken: 'rt' })
    await cli.list({ all: true })
    const h = captured?.options?.headers || {}
    await assert(h[HEADERS.COMMAND], (v) => v === COMMANDS.SERVICE_CALL)
    await assert(h[HEADERS.SERVICE_NAME], (v) => v === 'pm3-service')
    await assert(h[HEADERS.DEPLOY_TOKEN] == null || h[HEADERS.DEPLOY_TOKEN] === '', (x) => x)
    const body = parseBody(captured?.options)
    await assert(body?.command, (c) => c === 'list')
  } finally {
    global.fetch = originalFetch
  }
}

export async function testCreateRemotePm3CliStartFileSendsStartNotDeploy () {
  const registryUrl = 'http://registry.test'
  let captured = null
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    captured = { url, options }
    return jsonResponse({ ok: true })
  }
  try {
    const cli = createRemotePm3Cli({ registryUrl })
    await cli.startFile('/app/server.js', { internal: true })
    const body = parseBody(captured?.options)
    await assert(body?.command, (c) => c === 'start')
    await assert(body?.filepath, (f) => f === '/app/server.js')
  } finally {
    global.fetch = originalFetch
  }
}

export async function testCreateRemotePm3CliSendsPreferLocationHeader () {
  const registryUrl = 'http://registry.test'
  const prefer = 'http://node-a:9/pm3'
  let captured = null
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    captured = { url, options }
    return jsonResponse({ processes: [] })
  }
  try {
    const cli = createRemotePm3Cli({ registryUrl, preferLocation: prefer })
    await cli.list()
    const h = captured?.options?.headers || {}
    await assert(h[HEADERS.SERVICE_PREFER_LOCATION], (v) => v === prefer)
  } finally {
    global.fetch = originalFetch
  }
}

export async function testRequireRegistryUrlForRemoteThrowsWhenMissing () {
  await withEnv({ YAMF_REGISTRY_URL: undefined }, async () => {
    await assert(
      (() => {
        try {
          requireRegistryUrlForRemote()
          return false
        } catch (e) {
          return e?.message?.includes('YAMF_REGISTRY_URL')
        }
      })(),
      (x) => x === true
    )
  })
}
