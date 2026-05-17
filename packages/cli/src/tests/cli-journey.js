/**
 * CLI Integration / Journey Tests
 *
 * Exercises the CLI end-to-end via child_process.execSync, asserting on
 * real stdout/stderr output. Uses the example services shipped with the CLI.
 *
 * The test follows a full developer journey:
 *   local dev stack -> start services -> list -> logs -> stop -> delete
 */

import { assert, assertErr, sleep } from '@yamf/test'
import { envTruthy } from '@yamf/core'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, rmSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { runBootstrapWithEnv } from '../lib/bootstrap-for-tests.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const EXAMPLES = join(__dirname, '..', 'example')
const CLI_CWD = join(__dirname, '..')
const DEBUG = envTruthy(process.env.YAMF_TEST_DEBUG)

let ENV = null

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

async function resetEnv () {
  cleanup()
  const registryBaseUrl = await reserveRegistryBaseUrl()
  const yamfHome = mkdtempSync(join(tmpdir(), 'yamf-cli-journey-'))
  ENV = {
    ...process.env,
    YAMF_REGISTRY_URL: registryBaseUrl,
    YAMF_HOME: yamfHome,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    YAMF_GRACEFUL_SHUTDOWN_MS: '2000',
    YAMF_PM3_STOP_GRACE_MS: '5000',
    YAMF_PM3_POLL_INTERVAL_MS: '80',
    YAMF_PM3_POLL_STABLE_CHECKS: '2',
    YAMF_PM3_BROADCAST_SETTLE_MS: '400',
    YAMF_PM3_REGISTRY_CHECK_ATTEMPTS: '6',
    YAMF_PM3_REGISTRY_CHECK_MS: '50',
    YAMF_REGISTRY_TOKEN: undefined,
    YAMF_DEPLOY_TOKEN: undefined
  }
  await runBootstrapWithEnv(ENV)
}

function cli(cmd) {
  if (!ENV) throw new Error('test ENV not initialized; call resetEnv() before CLI usage')
  if (DEBUG) console.log(`\n> yamf ${cmd}`)
  try {
    const stdout = execSync(`node ${CLI} ${cmd}`, {
      env: ENV,
      cwd: CLI_CWD,
      encoding: 'utf8',
      // PM3 stop can wait for YAMF_GRACEFUL_SHUTDOWN_MS + headroom; 15s was too short.
      timeout: 120_000
    })
    const out = stdout.trim()
    if (DEBUG) console.log(out)
    return out
  } catch (err) {
    const combined = ((err.stdout || '') + '\n' + (err.stderr || '')).trim()
    err.output = combined
    if (DEBUG) console.log('[ERROR]', combined)
    throw err
  }
}

function cliSafe(cmd) {
  try {
    return cli(cmd)
  } catch (err) {
    return err.output || ''
  }
}

function cleanup() {
  if (!ENV) return
  cliSafe('stop --all')
  cliSafe('delete --all')
  if (ENV.YAMF_HOME && existsSync(ENV.YAMF_HOME)) {
    rmSync(ENV.YAMF_HOME, { recursive: true, force: true })
  }
  ENV = null
}

async function waitForServiceInList (serviceName, attempts = 20, delayMs = 150) {
  for (let i = 0; i < attempts; i++) {
    const out = cliSafe('list --services')
    if (out.includes(serviceName)) return out
    await sleep(delayMs)
  }
  return cliSafe('list --services')
}

// -- Tests --

export async function testCliHelp() {
  await resetEnv()
  try {
    const out = cli('--help')
    assert(out,
      o => o.includes('yamf <command>'),
      o => o.includes('start'),
      o => o.includes('stop'),
      o => o.includes('list'),
      o => o.includes('registry'),
      o => o.includes('request')
    )
  } finally {
    cleanup()
  }
}

export async function testUnknownCommandErrors() {
  await resetEnv()
  try {
    await assertErr(
      () => cli('nonexistent'),
      err => (err.output || err.stderr || '').includes('Unknown command')
    )
  } finally {
    cleanup()
  }
}

export async function testStartMissingFileErrors() {
  await resetEnv()
  try {
    await assertErr(
      () => cli('start'),
      err => {
        const msg = err.output || err.stderr || ''
        return msg.includes('Filename is required') || msg.includes('required')
      }
    )
  } finally {
    cleanup()
  }
}

export async function testInitDevStartsBootstrap() {
  await resetEnv()
  try {
    const listOut = cli('list --all')
    assert(listOut,
      o => o.includes('running'),
      o => o.includes('dev-bootstrap')
    )
  } finally {
    cleanup()
  }
}

export async function testStartAndStopService() {
  await resetEnv()
  try {
    const startOut = cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)
    assert(startOut,
      o => o.includes('Started process'),
      o => o.includes('load-balanced')
    )

    const listOut = cli('list')
    assert(listOut,
      o => o.includes('running'),
      o => o.includes('load-balanced')
    )

    const stopOut = cli(`stop ${join(EXAMPLES, 'load-balanced.js')}`)
    assert(stopOut,
      o => o.includes('Stopped')
    )
  } finally {
    cleanup()
  }
}

export async function testStopByServiceName() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    const listOut = await waitForServiceInList('simple-service')
    assert(listOut, o => o.includes('simple-service'))

    const stopOut = cli('stop simple-service')
    assert(stopOut, o => o.includes('Stopped'))
  } finally {
    cleanup()
  }
}

export async function testDeleteByServiceName() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)
    await waitForServiceInList('simple-service')

    cli('delete simple-service')
    const listOut = cli('list')
    assert(listOut,
      o => !o.includes('load-balanced')
    )
  } finally {
    cleanup()
  }
}

export async function testStartByServiceNameRestartsExisting() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)
    await waitForServiceInList('simple-service')

    const startOut = cli('start simple-service')
    assert(startOut,
      o => o.includes('Resolved service') || o.includes('Started process')
    )
  } finally {
    cleanup()
  }
}

export async function testStartUnknownServiceNameErrors() {
  await resetEnv()
  try {
    await assertErr(
      () => cli('start nonexistent-service'),
      err => {
        const msg = err.output || err.stderr || ''
        return msg.includes('provide a filepath') || msg.includes('Cannot start')
      }
    )
  } finally {
    cleanup()
  }
}

export async function testMultipleInstancesAndViews() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)
    cli(`start ${join(EXAMPLES, 'load-balanced.js')} --env YAMF_SERVICE_URL=http://127.0.0.1`)
    await waitForServiceInList('simple-service')

    const listOut = cli('list')
    assert(listOut,
      o => o.includes('load-balanced'),
      o => (o.match(/running/g) || []).length >= 2
    )

    const svcView = cli('list --services')
    assert(svcView, o => o.includes('simple-service'))

    const locView = cli('list --locations')
    assert(locView,
      o => o.includes('localhost') || o.includes('127.0.0.1')
    )
  } finally {
    cleanup()
  }
}

export async function testLogsCommand() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    const logsOut = cli(`logs ${join(EXAMPLES, 'load-balanced.js')}`)
    assert(logsOut,
      o => o.length > 0
    )
  } finally {
    cleanup()
  }
}

export async function testLogsList() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    const listOut = cli('logs --list')
    assert(listOut,
      o => o.includes('->'),
      o => o.includes('.log')
    )
  } finally {
    cleanup()
  }
}

export async function testDeleteRemovesFromList() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    cli(`delete ${join(EXAMPLES, 'load-balanced.js')}`)
    const listOut = cli('list')
    assert(listOut,
      o => !o.includes('load-balanced')
    )
  } finally {
    cleanup()
  }
}

export async function testStopAllAndDeleteAll() {
  await resetEnv()
  try {
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    cli('stop --all')
    const listOut = cli('list')
    assert(listOut,
      o => o.includes('No processes running.')
    )

    cli('delete --all')
    const listAllOut = cli('list --all')
    assert(listAllOut,
      o => o.includes('No processes running.')
    )
  } finally {
    cleanup()
  }
}
