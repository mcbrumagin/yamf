/**
 * Build + local deploy (rollout) + rolling upgrade using `yamf build` / `yamf deploy --local`.
 * Isolated YAMF_HOME, dedicated registry URL port, and a tiny fixture app under
 * `fixtures/build-deploy-harness/`.
 *
 * The registry port is chosen at runtime (free port). A fixed port (e.g. 18013) is unsafe:
 * if another `registryServer()` is started for the same YAMF_REGISTRY_URL (another test, stray
 * process) its `performRegistryDrainHandshake` will POST `REGISTRY_DRAIN` to that URL and the
 * already-running dev registry will enter `draining` and reject new SERVICE_SETUP with 503, so
 * `replicaMetadata` / `replicas[service]` in REGISTRY_PULL never appear.
 */

import { assert, sleep } from '@yamf/test'
import { httpRequest, HEADERS, COMMANDS } from '@yamf/core'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'node:net'
import { writeFileSync, existsSync, rmSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const HARNESS = join(__dirname, 'fixtures', 'build-deploy-harness')
const YAMF_HOME = join(__dirname, '..', '.yamf-build-deploy')
const CLI_CWD = join(__dirname, '..')
const DEBUG = process.env.YAMF_TEST_DEBUG === '1'

/**
 * @returns {Promise<string>} e.g. `http://127.0.0.1:45678` with an ephemeral free port
 */
function reserveRegistryBaseUrl () {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close((err) => (err != null ? reject(err) : resolve(`http://127.0.0.1:${port}`)))
    })
    s.on('error', reject)
  })
}

/**
 * @param {string} registryBaseUrl
 */
function makeTestEnv (registryBaseUrl) {
  const e = {
    ...process.env,
    YAMF_REGISTRY_URL: registryBaseUrl,
    YAMF_HOME,
    LOG_LEVEL: 'info',
    MUTE_LOG_GROUP_OUTPUT: 'true',
    MUTE_SUCCESS_CASES: 'true'
  }
  // Avoid inheriting a deploy token from the shell — pm3-service enforces it on deploy/rolling paths.
  delete e.YAMF_DEPLOY_TOKEN
  return e
}

/**
 * @param {string} cmd
 * @param {object} o
 * @param {import('node:process').ProcessEnv} o.env
 */
function cli (cmd, { timeout = 60000, cwd = CLI_CWD, env }) {
  if (!env) throw new Error('cli(): env is required (use makeTestEnv + reserveRegistryBaseUrl per test)')
  if (DEBUG) console.log(`\n> (cwd=${cwd}) yamf ${cmd}`)
  const stdout = execSync(`node ${CLI} ${cmd}`, {
    env,
    cwd,
    encoding: 'utf8',
    timeout
  })
  const out = stdout.trim()
  if (DEBUG) console.log(out.slice(0, 2000))
  return out
}

function cliSafe (cmd, { env, ...rest } = {}) {
  if (!env) throw new Error('cliSafe(): env is required')
  try {
    return cli(cmd, { env, ...rest })
  } catch (err) {
    return (err.stdout || '') + '\n' + (err.stderr || '')
  }
}

function parseLastJson (out) {
  for (let end = out.length - 1; end >= 0; end--) {
    if (out[end] !== '}') continue
    let depth = 0
    for (let i = end; i >= 0; i--) {
      const c = out[i]
      if (c === '}') depth++
      if (c === '{') {
        depth--
        if (depth === 0) {
          const candidate = out.slice(i, end + 1)
          try {
            const j = JSON.parse(candidate)
            if (j && typeof j === 'object' && 'decision' in j) return j
          } catch { /* */ }
          break
        }
      }
    }
  }
  throw new Error('Could not parse deploy JSON (decision) from output: ' + out.slice(-800))
}

const SERVICE_FILE = join(HARNESS, 'service-entry.js')
const V1_SOURCE = `/**
 * Bundle entry for build+deploy tests. Change BUNDLE_MARK to force a new content hash.
 */
import { createService } from '@yamf/core'

export const BUNDLE_MARK = 'v1'

await createService('deploy-int-svc', async () => ({
  service: 'deploy-int-svc',
  mark: BUNDLE_MARK
}))
`

const V2_SOURCE = V1_SOURCE.replace("export const BUNDLE_MARK = 'v1'", "export const BUNDLE_MARK = 'v2'")

/**
 * @param {import('node:process').ProcessEnv} env
 */
function cleanup (env) {
  writeFileSync(SERVICE_FILE, V1_SOURCE, 'utf8')
  cliSafe('stop --all', { env })
  cliSafe('delete --all', { env })
  if (existsSync(YAMF_HOME)) {
    rmSync(YAMF_HOME, { recursive: true, force: true })
  }
}

/**
 * @param {import('node:process').ProcessEnv} env
 */
function pullReplicas (env) {
  if (!env.YAMF_REGISTRY_URL) throw new Error('YAMF_REGISTRY_URL missing in env')
  return httpRequest(env.YAMF_REGISTRY_URL, {
    headers: { [HEADERS.COMMAND]: COMMANDS.REGISTRY_PULL }
  })
}

export async function testYamfBuildAndDeployLocalRolloutWithSourceHashInRegistry () {
  const registryBaseUrl = await reserveRegistryBaseUrl()
  const env = makeTestEnv(registryBaseUrl)
  cleanup(env)
  try {
    cli('init --dev', { timeout: 45000, env })
    await sleep(2000)

    cli('build deploy-int-svc', { timeout: 120000, cwd: HARNESS, env })

    const out = cli('deploy --local deploy-int-svc', { timeout: 90000, cwd: HARNESS, env })
    const r = parseLastJson(out)
    await assert(
      r.decision,
      (d) => d === 'rollout' || d === 'scale'
    )
    await assert(r.added, (a) => a === 1)

    await sleep(2000)
    const pull = await pullReplicas(env)
    const rep = pull.replicas?.['deploy-int-svc']
    await assert(Array.isArray(rep), (x) => x === true)
    await assert(rep.length, (n) => n >= 1)
    const h = rep[0].sourceHash
    await assert(h, (s) => typeof s === 'string' && s.startsWith('sha256-'))

    const verOut = cli('status --versions', { timeout: 30000, cwd: CLI_CWD, env })
    await assert(verOut, (o) => o.includes('deploy-int-svc') && o.includes('sha256-'))
  } finally {
    cleanup(env)
  }
}

export async function testYamfDeployNoopWhenSameHashAndRollingWhenBundleChanges () {
  const registryBaseUrl = await reserveRegistryBaseUrl()
  const env = makeTestEnv(registryBaseUrl)
  cleanup(env)
  try {
    cli('init --dev', { timeout: 45000, env })
    await sleep(2000)
    writeFileSync(SERVICE_FILE, V1_SOURCE, 'utf8')

    cli('build deploy-int-svc', { timeout: 120000, cwd: HARNESS, env })
    const out1 = cli('deploy --local deploy-int-svc', { timeout: 90000, cwd: HARNESS, env })
    const r1 = parseLastJson(out1)
    await assert(r1.added, (a) => a === 1)
    await sleep(2000)
    const hash1 = (await pullReplicas(env)).replicas['deploy-int-svc'][0].sourceHash

    const outNoop = cli('deploy --local deploy-int-svc', { timeout: 60000, cwd: HARNESS, env })
    const noop = parseLastJson(outNoop)
    await assert(noop.decision, (d) => d === 'noop')

    writeFileSync(SERVICE_FILE, V2_SOURCE, 'utf8')
    cli('build deploy-int-svc', { timeout: 120000, cwd: HARNESS, env })
    const out2 = cli('deploy --local deploy-int-svc', { timeout: 120000, cwd: HARNESS, env })
    const r2 = parseLastJson(out2)
    await assert(r2.decision, (d) => d === 'rolling')

    await sleep(2000)
    const afterRoll = await pullReplicas(env)
    const hash2 = afterRoll.replicas['deploy-int-svc'][0].sourceHash
    await assert(hash1, (a) => a !== hash2)
  } finally {
    cleanup(env)
  }
}
