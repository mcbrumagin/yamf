import { assert, assertErr } from '@yamf/test'
import { HEADERS, COMMANDS } from '@yamf/core'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { planAndApply, resolveLocalRollingTarget, mergeRequiredEnvFromProcess, uploadDeployBundleToRegistry } from '../lib/deploy-driver.js'

/**
 * ESM that dynamic-imports @yamf/core and supports YAMF_EXTRACT_SERVICE_CONTRACT (no node_modules in tmp cwd).
 * @param {string} [serviceName]
 */
function makeTestServiceBundle (serviceName = 'sample-svc') {
  const require = createRequire(fileURLToPath(new URL('../../package.json', import.meta.url)))
  const href = pathToFileURL(require.resolve('@yamf/core')).href
  return `import { createService } from ${JSON.stringify(href)}
export default async function yamfDeployTestEntry () {
  return createService(${JSON.stringify(serviceName)}, async () => ({}), { useContract: false })
}
`
}

export async function testResolveLocalRollingTargetUsesRunningBundlePathFallback () {
  const cwd = mkdtempSync(join(tmpdir(), 'yamf-deploy-driver-'))
  const pm3 = {
    async list () {
      return [
        {
          status: 'running',
          internal: false,
          filepath: join(cwd, '.yamf', 'build', 'sample-svc', 'old-hash.mjs')
        }
      ]
    }
  }
  try {
    const target = await resolveLocalRollingTarget(
      pm3,
      'sample-svc',
      cwd,
      join(cwd, '.yamf', 'build', 'sample-svc', 'new-hash.mjs'),
      'sample-svc',
      false
    )
    await assert(target, (v) => v === join(cwd, '.yamf', 'build', 'sample-svc', 'old-hash.mjs'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

export async function testResolveLocalRollingTargetSkipsFallbackForRemotePm3 () {
  const cwd = mkdtempSync(join(tmpdir(), 'yamf-deploy-driver-'))
  const pm3 = {
    async list () {
      return [
        {
          status: 'running',
          internal: false,
          filepath: join(cwd, '.yamf', 'build', 'sample-svc', 'old-hash.mjs')
        }
      ]
    }
  }
  try {
    const target = await resolveLocalRollingTarget(
      pm3,
      'sample-svc',
      cwd,
      join(cwd, '.yamf', 'build', 'sample-svc', 'new-hash.mjs'),
      'sample-svc',
      true
    )
    await assert(target, (v) => v === 'sample-svc')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

function jsonResponse (obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(obj),
    json: async () => obj
  }
}

export async function testPlanAndApplyRollingUsesFilepathFallbackWhenServiceKeyMissing () {
  const cwd = mkdtempSync(join(tmpdir(), 'yamf-deploy-driver-'))
  const registryUrl = 'http://registry.test'
  const newHash = 'sha256-new'
  const oldBundle = join(cwd, '.yamf', 'build', 'sample-svc', 'sha256-old.mjs')
  const newBundle = join(cwd, '.yamf', 'build', 'sample-svc', `${newHash}.mjs`)
  mkdirSync(join(cwd, '.yamf', 'build', 'sample-svc'), { recursive: true })
  writeFileSync(oldBundle, makeTestServiceBundle('sample-svc'), 'utf8')
  writeFileSync(newBundle, makeTestServiceBundle('sample-svc'), 'utf8')
  let rollingTarget = null
  const pm3 = {
    filepathForService: () => null,
    async list () {
      return [{ status: 'running', internal: false, filepath: oldBundle }]
    },
    async restartRolling (target) {
      rollingTarget = target
      return { replaced: [{ oldKey: oldBundle, newKey: newBundle }] }
    }
  }
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    if (url === registryUrl && options?.headers?.[HEADERS.COMMAND] === COMMANDS.REGISTRY_PULL) {
      return jsonResponse({
        replicas: { 'sample-svc': [{ sourceHash: 'sha256-old' }] }
      })
    }
    throw new Error(`Unexpected fetch in test: ${url}`)
  }
  try {
    const res = await planAndApply({
      yamfService: { name: 'sample-svc', registeredServiceName: 'sample-svc', entry: 'src/app.js', replicas: 1, env: [] },
      hash: newHash,
      pm3,
      registryUrl,
      cwd,
      remote: false
    })
    await assert(res.decision, (d) => d === 'rolling')
    await assert(rollingTarget, (t) => t === oldBundle)
  } finally {
    global.fetch = originalFetch
    rmSync(cwd, { recursive: true, force: true })
  }
}

export async function testPlanAndApplyRemoteRollingDoesNotUseLocalFilepathFallback () {
  const cwd = mkdtempSync(join(tmpdir(), 'yamf-deploy-driver-'))
  const registryUrl = 'http://registry.test'
  const newHash = 'sha256-new'
  const newBundle = join(cwd, '.yamf', 'build', 'sample-svc', `${newHash}.mjs`)
  mkdirSync(join(cwd, '.yamf', 'build', 'sample-svc'), { recursive: true })
  const oldB = join(cwd, '.yamf', 'build', 'sample-svc', 'sha256-old.mjs')
  writeFileSync(oldB, makeTestServiceBundle('sample-svc'), 'utf8')
  writeFileSync(newBundle, makeTestServiceBundle('sample-svc'), 'utf8')
  let rollingTarget = null
  const pm3 = {
    filepathForService: () => null,
    async list () {
      return [{ status: 'running', internal: false, filepath: oldB }]
    },
    async restartRolling (target) {
      rollingTarget = target
      return { replaced: [{ oldKey: 'sample-svc#0', newKey: 'sample-svc#0' }] }
    }
  }
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    if (url === registryUrl && options?.headers?.[HEADERS.COMMAND] === COMMANDS.REGISTRY_PULL) {
      return jsonResponse({
        replicas: { 'sample-svc': [{ sourceHash: 'sha256-old' }] }
      })
    }
    if (url === registryUrl && options?.method === 'POST' && options?.headers?.[HEADERS.COMMAND] === 'deploy-bundle') {
      return jsonResponse({ ok: true })
    }
    throw new Error(`Unexpected fetch in test: ${url}`)
  }
  try {
    const res = await planAndApply({
      yamfService: { name: 'sample-svc', registeredServiceName: 'sample-svc', entry: 'src/app.js', replicas: 1, env: [] },
      hash: newHash,
      pm3,
      registryUrl,
      cwd,
      remote: true,
      deployToken: 'test-token'
    })
    await assert(res.decision, (d) => d === 'rolling')
    await assert(rollingTarget, (t) => t === 'sample-svc')
  } finally {
    global.fetch = originalFetch
    rmSync(cwd, { recursive: true, force: true })
  }
}

/**
 * yamf dev: REGISTRY_PULL can report replica rows for the current hash (noop) while PM3 is not
 * actually running that bundle — re-decide to rollout/scale/rolling and apply.
 */
export async function testPlanAndApplyFromYamfDevRedeploysWhenRegistryNoopButNoRunningBundle () {
  const cwd = mkdtempSync(join(tmpdir(), 'yamf-deploy-driver-'))
  const registryUrl = 'http://registry.test'
  const hash = 'sha256-new'
  const bundlePath = join(cwd, '.yamf', 'build', 'sample-svc', `${hash}.mjs`)
  mkdirSync(join(cwd, '.yamf', 'build', 'sample-svc'), { recursive: true })
  writeFileSync(bundlePath, makeTestServiceBundle('sample-svc'), 'utf8')

  const startCalls = []
  const pm3 = {
    async list () {
      return []
    },
    async delete () { /* prune no-op */ },
    async start (path, opts) {
      startCalls.push({ path, env: opts?.env })
      return { filepath: path, pid: 1 }
    }
  }

  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    if (url === registryUrl && options?.headers?.[HEADERS.COMMAND] === COMMANDS.REGISTRY_PULL) {
      return jsonResponse({
        replicas: { 'sample-svc': [{ sourceHash: hash, location: 'stale' }] }
      })
    }
    throw new Error(`Unexpected fetch in test: ${url}`)
  }

  const originalStderrWrite = process.stderr.write
  process.stderr.write = () => true

  try {
    const res = await planAndApply({
      yamfService: { name: 'sample-svc', registeredServiceName: 'sample-svc', entry: 'src/app.js', replicas: 1, env: [] },
      hash,
      pm3,
      registryUrl,
      cwd,
      remote: false,
      fromYamfDev: true
    })
    await assert(res.decision, (d) => d === 'rollout')
    await assert(res.added, (a) => a === 1)
    await assert(startCalls.length, (n) => n === 1)
    await assert(startCalls[0].path, (p) => p === bundlePath)
  } finally {
    global.fetch = originalFetch
    process.stderr.write = originalStderrWrite
    rmSync(cwd, { recursive: true, force: true })
  }
}

export async function testPlanAndApplyFromYamfDevStaysNoopWhenPm3RunsThisBundle () {
  const cwd = mkdtempSync(join(tmpdir(), 'yamf-deploy-driver-'))
  const registryUrl = 'http://registry.test'
  const hash = 'sha256-new'
  const bundlePath = join(cwd, '.yamf', 'build', 'sample-svc', `${hash}.mjs`)
  mkdirSync(join(cwd, '.yamf', 'build', 'sample-svc'), { recursive: true })
  writeFileSync(bundlePath, makeTestServiceBundle('sample-svc'), 'utf8')

  const pm3 = {
    async list () {
      return [{ status: 'running', internal: false, filepath: bundlePath }]
    }
  }

  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    if (url === registryUrl && options?.headers?.[HEADERS.COMMAND] === COMMANDS.REGISTRY_PULL) {
      return jsonResponse({
        replicas: { 'sample-svc': [{ sourceHash: hash }] }
      })
    }
    throw new Error(`Unexpected fetch in test: ${url}`)
  }

  try {
    const res = await planAndApply({
      yamfService: { name: 'sample-svc', registeredServiceName: 'sample-svc', entry: 'src/app.js', replicas: 1, env: [] },
      hash,
      pm3,
      registryUrl,
      cwd,
      remote: false,
      fromYamfDev: true
    })
    await assert(res.decision, (d) => d === 'noop')
    await assert(res.replicas, (n) => n === 1)
  } finally {
    global.fetch = originalFetch
    rmSync(cwd, { recursive: true, force: true })
  }
}

export function testMergeRequiredEnvFromProcessFillsMissingFromProcessEnv () {
  const key = 'YAMF_CLI_MERGE_TEST_ABC'
  const prev = process.env[key]
  process.env[key] = 'env-val'
  try {
    const out = mergeRequiredEnvFromProcess([key, 'PATH'], { PATH: '/x' })
    assert(out[key], (v) => v === 'env-val')
    assert(out.PATH, (v) => v === '/x')
  } finally {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
}

export async function testPlanAndApplyNoopDryRunReturnsSkippedContract () {
  const cwd = mkdtempSync(join(tmpdir(), 'yamf-deploy-driver-'))
  const registryUrl = 'http://registry.test'
  const hash = 'sha256-same'
  const pm3 = { async list () { return [] } }
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    if (url === registryUrl && options?.headers?.[HEADERS.COMMAND] === COMMANDS.REGISTRY_PULL) {
      return jsonResponse({
        replicas: { 'sample-svc': [{ sourceHash: hash }] }
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  try {
    const res = await planAndApply({
      yamfService: { name: 'sample-svc', registeredServiceName: 'sample-svc', entry: 'src/app.js', replicas: 1, env: [] },
      hash,
      pm3,
      registryUrl,
      cwd,
      remote: false,
      dryRun: true
    })
    await assert(res.decision, (d) => d === 'noop')
    await assert(res.dryRun, (x) => x === true)
    await assert(res.contract?.skipped, (s) => typeof s === 'string' && s.includes('no deploy needed'))
  } finally {
    global.fetch = originalFetch
    rmSync(cwd, { recursive: true, force: true })
  }
}

export async function testPlanAndApplyThrowsWhenBundleFileMissing () {
  const cwd = mkdtempSync(join(tmpdir(), 'yamf-deploy-driver-'))
  const registryUrl = 'http://registry.test'
  const newHash = 'sha256-missing-file'
  const pm3 = { async list () { return [] } }
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    if (url === registryUrl && options?.headers?.[HEADERS.COMMAND] === COMMANDS.REGISTRY_PULL) {
      return jsonResponse({ replicas: {} })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  try {
    await assertErr(
      async () =>
        planAndApply({
          yamfService: { name: 'sample-svc', registeredServiceName: 'sample-svc', entry: 'src/app.js', replicas: 1, env: [] },
          hash: newHash,
          pm3,
          registryUrl,
          cwd,
          remote: false
        }),
      (e) => /Bundle missing/i.test(e.message)
    )
  } finally {
    global.fetch = originalFetch
    rmSync(cwd, { recursive: true, force: true })
  }
}

export async function testUploadDeployBundleRequiresToken () {
  await assertErr(
    async () =>
      uploadDeployBundleToRegistry({
        registryUrl: 'http://r.test',
        hash: 'sha256-x',
        bundlePath: join(tmpdir(), 'nonexistent-bundle.mjs'),
        deployToken: ''
      }),
    (e) => /YAMF_DEPLOY_TOKEN/i.test(e.message)
  )
}
