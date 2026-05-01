/**
 * Direct coverage for `logs`, `restart`, `list`, `nodes` — help, validation, and PM3-backed paths
 * with prototype stubs; also the `list --live-registry` no-URL fast path.
 */
import { assert, assertErr } from '@yamf/test'
import { PM3 } from '../lib/pm3.js'
import { runLogsCommand } from '../commands/logs.js'
import { runRestartCommand } from '../commands/restart.js'
import { runListCommand } from '../commands/list.js'
import { runNodesCommand } from '../commands/nodes.js'
import { runStatusCommand } from '../commands/status.js'

function captureConsoleLog () {
  const lines = []
  const orig = console.log
  console.log = (...args) => {
    lines.push(args.join(' '))
  }
  return {
    lines,
    restore () {
      console.log = orig
    }
  }
}

function stubPm3 (methods) {
  const saved = {}
  for (const [name, impl] of Object.entries(methods)) {
    saved[name] = PM3.prototype[name]
    PM3.prototype[name] = impl
  }
  return () => {
    for (const name of Object.keys(methods)) {
      PM3.prototype[name] = saved[name]
    }
  }
}

export async function testLogsHelp () {
  const cap = captureConsoleLog()
  try {
    await runLogsCommand(['--help'])
    await assert(cap.lines.join('\n'), (t) => t.includes('yamf logs') && t.includes('--list'))
  } finally {
    cap.restore()
  }
}

export async function testLogsRemoteListRejected () {
  await assertErr(
    async () => runLogsCommand(['/any', '--remote', '--list']),
    (e) => /list --remote/i.test(e.message)
  )
}

export async function testLogsRemoteWatchRejected () {
  await assertErr(
    async () => runLogsCommand(['/any', '--remote', '--watch']),
    (e) => /--watch.*remote/i.test(e.message)
  )
}

export async function testLogsRemoteRequiresPath () {
  await assertErr(
    async () => runLogsCommand(['--remote']),
    (e) => /filepath.*remote/i.test(e.message)
  )
}

export async function testLogsListEmptyPrintsNoFiles () {
  const restore = stubPm3({
    logFiles () {
      return []
    }
  })
  const cap = captureConsoleLog()
  try {
    await runLogsCommand(['--list'])
    await assert(cap.lines.join('\n'), (t) => t.includes('No log files'))
  } finally {
    cap.restore()
    restore()
  }
}

export async function testLogsListShowsMapping () {
  const restore = stubPm3({
    logFiles () {
      return [
        {
          filepath: '/proj/services/foo.js',
          stateKey: 'foo#1',
          logFile: '/proj/.yamf/pm3/logs/foo-1.log'
        }
      ]
    }
  })
  const cap = captureConsoleLog()
  try {
    await runLogsCommand(['--list'])
    const out = cap.lines.join('\n')
    await assert(out, (t) => t.includes('foo#1') && t.includes('->'))
  } finally {
    cap.restore()
    restore()
  }
}

export async function testLogsReadsFileViaPm3 () {
  const restore = stubPm3({
    async logs () {
      return 'line1\nline2'
    }
  })
  const cap = captureConsoleLog()
  try {
    await runLogsCommand(['my-service.js', '-n', '2'])
    await assert(cap.lines.join('\n'), (t) => t.includes('line1'))
  } finally {
    cap.restore()
    restore()
  }
}

export async function testRestartHelp () {
  const cap = captureConsoleLog()
  try {
    await runRestartCommand(['--help'])
    await assert(cap.lines.join('\n'), (t) => t.includes('yamf restart') && t.includes('--rolling'))
  } finally {
    cap.restore()
  }
}

export async function testRestartRollingAndAllRejected () {
  await assertErr(
    async () => runRestartCommand(['--rolling', '--all']),
    (e) => /--rolling.*--all/i.test(e.message)
  )
}

export async function testRestartRemoteAndAllRejected () {
  await assertErr(
    async () => runRestartCommand(['--remote', '--all']),
    (e) => /--all.*--remote/i.test(e.message)
  )
}

export async function testRestartRequiresTargetWithoutAll () {
  await assertErr(
    async () => runRestartCommand([]),
    (e) => /restart <target>|--all/i.test(e.message)
  )
}

export async function testRestartAllRestartsRunningOnly () {
  const restarted = []
  const restore = stubPm3({
    async list () {
      return [
        { status: 'running', filepath: '/a.js' },
        { status: 'stopped', filepath: '/b.js' }
      ]
    },
    async restart (fp) {
      restarted.push(fp)
      return { ok: true }
    }
  })
  try {
    await runRestartCommand(['--all'])
    await assert(restarted, (r) => r.length === 1 && r[0] === '/a.js')
  } finally {
    restore()
  }
}

export async function testRestartRollingInvokesPm3 () {
  let target = null
  const restore = stubPm3({
    async restartRolling (t) {
      target = t
      return { replaced: [{ oldKey: 'x', newKey: 'y' }] }
    }
  })
  try {
    await runRestartCommand(['svc-a', '--rolling'])
    await assert(target, (x) => x === 'svc-a')
  } finally {
    restore()
  }
}

export async function testListHelp () {
  const cap = captureConsoleLog()
  try {
    await runListCommand(['--help'])
    await assert(cap.lines.join('\n'), (t) => t.includes('yamf list') && t.includes('--live-registry'))
  } finally {
    cap.restore()
  }
}

export async function testListVerbosePrintsLogPaths () {
  const restore = stubPm3({
    async list () {
      return [
        { filepath: '/app/worker.js', pid: 1, status: 'running', services: {}, logFile: '/logs/w.log' },
        { filepath: '/app/nolog.js', pid: 2, status: 'running', services: {} }
      ]
    }
  })
  const cap = captureConsoleLog()
  try {
    await runListCommand(['-v'])
    const out = cap.lines.join('\n')
    await assert(out, (t) => t.includes('worker.js') && t.includes('w.log'))
  } finally {
    cap.restore()
    restore()
  }
}

export async function testListServicesView () {
  const restore = stubPm3({
    async list () {
      return [
        {
          filepath: '/x.js',
          pid: 9,
          status: 'running',
          services: { cache: ['http://127.0.0.1:1'] }
        }
      ]
    }
  })
  const cap = captureConsoleLog()
  try {
    await runListCommand(['--services'])
    await assert(cap.lines.join('\n'), (t) => t.includes('cache'))
  } finally {
    cap.restore()
    restore()
  }
}

// ---------------------------------------------------------------------------
// list --live-registry fast path (no URL set → stderr skip message, no crash)
// ---------------------------------------------------------------------------

export async function testListLiveRegistryNoUrl () {
  const restore = stubPm3({ async list () { return [] } })
  const savedUrl = process.env.YAMF_REGISTRY_URL
  delete process.env.YAMF_REGISTRY_URL
  const stderrLines = []
  const origWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk, ...rest) => {
    stderrLines.push(typeof chunk === 'string' ? chunk : String(chunk))
    return true
  }
  const cap = captureConsoleLog()
  try {
    await runListCommand(['--live-registry'])
    await assert(
      stderrLines.join(''),
      (t) => t.includes('YAMF_REGISTRY_URL is not set')
    )
  } finally {
    cap.restore()
    process.stderr.write = origWrite
    if (savedUrl !== undefined) process.env.YAMF_REGISTRY_URL = savedUrl
    restore()
  }
}

// ---------------------------------------------------------------------------
// nodes.js tests
// ---------------------------------------------------------------------------

export async function testNodesHelp () {
  const cap = captureConsoleLog()
  try {
    await runNodesCommand(['--help'])
    await assert(
      cap.lines.join('\n'),
      (t) => t.includes('yamf nodes') && t.includes('--verbose')
    )
  } finally {
    cap.restore()
  }
}

export async function testNodesMissingRegistryUrl () {
  const savedUrl = process.env.YAMF_REGISTRY_URL
  delete process.env.YAMF_REGISTRY_URL
  const exitCodes = []
  const origExit = process.exit
  process.exit = (code) => { exitCodes.push(code) }
  const origCE = console.error
  const ceLines = []
  console.error = (...args) => ceLines.push(args.join(' '))
  try {
    // Stubbing process.exit lets execution continue; catch any downstream crash.
    await runNodesCommand([]).catch(() => {})
    await assert(exitCodes, (c) => c.includes(1))
    await assert(ceLines.join('\n'), (t) => t.includes('YAMF_REGISTRY_URL'))
  } finally {
    process.exit = origExit
    console.error = origCE
    if (savedUrl !== undefined) process.env.YAMF_REGISTRY_URL = savedUrl
  }
}

export async function testStatusVersionsInvalidSinceFailsBeforeRegistryLookup () {
  const exitCodes = []
  const origExit = process.exit
  const origCE = console.error
  const ceLines = []
  process.exit = (code) => { exitCodes.push(code) }
  console.error = (...args) => ceLines.push(args.join(' '))
  try {
    await runStatusCommand(['--versions', '--since', 'not-a-date'])
    await assert(exitCodes, (c) => c.includes(1))
    await assert(ceLines.join('\n'), (t) => t.includes('--since: invalid date'))
  } finally {
    process.exit = origExit
    console.error = origCE
  }
}
