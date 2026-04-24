import { createInterface } from 'node:readline'
import { httpRequest, HEADERS, COMMANDS } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'

const ARGS = {
  help: { flags: ['-h', '--help'] },
  env: { flags: ['-e', '--env'], type: 'string' },
  reveal: { flags: ['--reveal'] }
}

function getConfigHelp () {
  return `
yamf config - Talk to config-service (Phase 2)

Usage:
  yamf config get <service> [options]     Call config-service get (values masked)
  yamf config set <service> <KEY=VALUE> [options]   Set a key (requires YAMF_CONFIG_ADMIN_TOKEN on server)
  yamf config list [options]              List config entries (no values)

Environment:
  YAMF_REGISTRY_URL
  YAMF_REGISTRY_TOKEN   (if registry requires it)

Options:
  -e, --env NAME   Environment namespace (default: local)
  --reveal         On get, print values (use only in a safe environment)
  -h, --help
`
}

async function promptHidden (q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return await new Promise((resolve) => {
    rl.question(q, (a) => {
      rl.close()
      resolve((a || '').trim())
    })
  })
}

function parseKeyValue (s) {
  const eq = s.indexOf('=')
  if (eq === -1) return null
  return { key: s.slice(0, eq), value: s.slice(eq + 1) }
}

export async function runConfigCommand (args) {
  const sub = args[0]
  const rest = args.slice(1)
  if (!sub || sub === '-h' || sub === '--help') {
    console.log(getConfigHelp())
    return
  }
  const options = parseArgs(rest, ARGS)
  if (options.help) {
    console.log(getConfigHelp())
    return
  }
  const registryUrl = process.env.YAMF_REGISTRY_URL
  if (!registryUrl) {
    throw new Error('YAMF_REGISTRY_URL is required')
  }
  const token = process.env.YAMF_REGISTRY_TOKEN || ''
  const envName = options.env || 'local'

  const baseHeaders = {
    'content-type': 'application/json',
    [HEADERS.COMMAND]: COMMANDS.SERVICE_CALL,
    [HEADERS.SERVICE_NAME]: 'config-service',
    ...(token && { [HEADERS.REGISTRY_TOKEN]: token })
  }

  if (sub === 'get') {
    const pos = options._positional[0]
    if (!pos) throw new Error('Usage: yamf config get <service>')
    const r = await httpRequest(registryUrl, {
      method: 'POST',
      headers: baseHeaders,
      body: { command: 'get', service: pos, env: envName }
    })
    if (options.reveal) {
      console.log(JSON.stringify(r, null, 2))
    } else {
      const keys = Object.keys(r.values || {})
      const masked = Object.fromEntries(keys.map((k) => [k, '***']))
      console.log(JSON.stringify({ ...r, values: masked }, null, 2))
    }
    return
  }

  if (sub === 'list') {
    const r = await httpRequest(registryUrl, {
      method: 'POST',
      headers: baseHeaders,
      body: { command: 'list' }
    })
    console.log(JSON.stringify(r, null, 2))
    return
  }

  if (sub === 'set') {
    const pos = options._positional
    const service = pos[0]
    const kv = pos[1] ? parseKeyValue(pos[1]) : null
    if (!service) {
      throw new Error('Usage: yamf config set <service> KEY=VALUE or KEY= (prompt for value)')
    }
    const admin = process.env.YAMF_CONFIG_ADMIN_TOKEN || (await promptHidden('YAMF_CONFIG_ADMIN_TOKEN: '))
    let key, value
    if (kv) {
      key = kv.key
      value = kv.value
      if (value === '' && !process.stdin.isTTY) {
        throw new Error('Empty value: pass KEY=value in argv or use a TTY to prompt')
      }
      if (value === '') {
        value = await promptHidden(`Value for ${key}: `)
      }
    } else {
      const pair = (await promptHidden('KEY=VALUE: ')) || ''
      const p = parseKeyValue(pair)
      if (!p) throw new Error('Expected KEY=VALUE')
      key = p.key
      value = p.value
    }
    const body = {
      command: 'set',
      service,
      env: envName,
      values: { [key]: value },
      adminToken: admin
    }
    const r = await httpRequest(registryUrl, { method: 'POST', headers: baseHeaders, body })
    console.log(JSON.stringify(r, null, 2))
    return
  }

  throw new Error(`Unknown config subcommand: ${sub}. Try: yamf config get | set | list`)
}
