/**
 * CLI Integration / Journey Tests
 *
 * Exercises the CLI end-to-end via child_process.execSync, asserting on
 * real stdout/stderr output. Uses the example services shipped with the CLI.
 *
 * The test follows a full developer journey:
 *   init --dev -> start services -> list -> logs -> stop -> delete
 */

import { assert, assertErr, sleep } from '@yamf/test'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.js')
const EXAMPLES = join(__dirname, '..', 'example')
const YAMF_HOME = join(__dirname, '..', '.yamf-test')
const CLI_CWD = join(__dirname, '..')
const DEBUG = true

const ENV = {
  ...process.env,
  YAMF_REGISTRY_URL: 'http://localhost:18001',
  YAMF_HOME,
  LOG_LEVEL: 'info',
  MUTE_LOG_GROUP_OUTPUT: 'true'
}

function cli(cmd) {
  if (DEBUG) console.log(`\n> yamf ${cmd}`)
  try {
    const stdout = execSync(`node ${CLI} ${cmd}`, {
      env: ENV,
      cwd: CLI_CWD,
      encoding: 'utf8',
      timeout: 15000
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
  cliSafe('stop --all')
  cliSafe('delete --all')
  if (existsSync(YAMF_HOME)) {
    rmSync(YAMF_HOME, { recursive: true, force: true })
  }
}

// -- Tests --

export async function testCliHelp() {
  const out = cli('--help')
  assert(out,
    o => o.includes('yamf <command>'),
    o => o.includes('start'),
    o => o.includes('stop'),
    o => o.includes('list'),
    o => o.includes('route'),
    o => o.includes('request')
  )
}

export async function testUnknownCommandErrors() {
  await assertErr(
    () => cli('nonexistent'),
    err => (err.output || err.stderr || '').includes('Unknown command')
  )
}

export async function testStartMissingFileErrors() {
  await assertErr(
    () => cli('start'),
    err => {
      const msg = err.output || err.stderr || ''
      return msg.includes('Filename is required') || msg.includes('required')
    }
  )
}

export async function testInitDevStartsBootstrap() {
  cleanup()
  try {
    const out = cli('init --dev')
    assert(out,
      o => o.includes('Started process'),
      o => o.includes('dev-bootstrap')
    )

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
  cleanup()
  try {
    cli('init --dev')
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
  cleanup()
  try {
    cli('init --dev')
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    const listOut = cli('list --services')
    assert(listOut, o => o.includes('simple-service'))

    const stopOut = cli('stop simple-service')
    assert(stopOut, o => o.includes('Stopped'))
  } finally {
    cleanup()
  }
}

export async function testDeleteByServiceName() {
  cleanup()
  try {
    cli('init --dev')
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

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
  cleanup()
  try {
    cli('init --dev')
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)

    const startOut = cli('start simple-service')
    assert(startOut,
      o => o.includes('Resolved service') || o.includes('Started process')
    )
  } finally {
    cleanup()
  }
}

export async function testStartUnknownServiceNameErrors() {
  cleanup()
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
  cleanup()
  try {
    cli('init --dev')
    cli(`start ${join(EXAMPLES, 'load-balanced.js')}`)
    cli(`start ${join(EXAMPLES, 'load-balanced.js')} --env YAMF_SERVICE_URL=http://127.0.0.1`)

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
  cleanup()
  try {
    cli('init --dev')
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
  cleanup()
  try {
    cli('init --dev')
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
  cleanup()
  try {
    cli('init --dev')
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
  cleanup()
  try {
    cli('init --dev')
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
