/**
 * REGRESSION: --remote for `yamf deploy` must be a boolean flag, not a string consumer,
 * or `yamf deploy --remote my-service` mis-parses (service name lost).
 */
import { assert } from '@yamf/test'
import parseArgs from '../lib/parse-args.js'

const DEPLOY_ARGS = {
  help: { flags: ['-h', '--help'] },
  local: { flags: ['--local'] },
  remote: { flags: ['-r', '--remote'] },
  hash: { flags: ['--hash'], type: 'string' },
  env: { flags: ['-e', '--env'], type: 'string' },
  replicas: { flags: ['-i', '--replicas'], type: 'number' },
  rollback: { flags: ['--rollback'], type: 'string' },
  force: { flags: ['--force'] }
}

export async function testDeployRemoteFlagIsBooleanEatsPositionalAsService () {
  const o = parseArgs(['--remote', 'my-app'], DEPLOY_ARGS)
  await assert(o, (x) => x.remote === true)
  await assert(o, (x) => x._positional[0] === 'my-app')
}

export async function testDeployLocalAndRemoteExclusion () {
  const o = parseArgs(['--local', 'svc'], DEPLOY_ARGS)
  await assert(o, (x) => x.local === true && x._positional[0] === 'svc')
}
