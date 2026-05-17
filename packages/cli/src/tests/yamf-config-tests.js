/**
 * @file load-yamf-config normalization + discovery
 */
import { assert } from '@yamf/test'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadYamfConfig } from '../lib/load-yamf-config.js'

export async function testLoadYamfConfigReturnsNullWhenMissing () {
  const d = mkdtempSync(join(tmpdir(), 'yamf-cfg-miss-'))
  try {
    const cfg = await loadYamfConfig(d)
    await assert(cfg, (c) => c == null)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

export async function testLoadYamfConfigNormalizesLegacyReplicaKey () {
  const d = mkdtempSync(join(tmpdir(), 'yamf-cfg-legacy-'))
  try {
    writeFileSync(
      join(d, 'yamf.config.mjs'),
      `export default {
  services: [{ name: 'app', entry: 'src/a.js', replicaKey: 'in-bundle-name' }]
}
`,
      'utf8'
    )
    const cfg = await loadYamfConfig(d)
    await assert(cfg?.services?.[0]?.registeredServiceName, (x) => x === 'in-bundle-name')
    await assert(cfg?.services?.[0]?.replicaKey, (x) => x === undefined)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

export async function testLoadYamfConfigPrefersRegisteredServiceNameOverReplicaKey () {
  const d = mkdtempSync(join(tmpdir(), 'yamf-cfg-both-'))
  try {
    writeFileSync(
      join(d, 'yamf.config.mjs'),
      `export default {
  services: [{ name: 'app', entry: 'x.js', registeredServiceName: 'winner', replicaKey: 'loser' }]
}
`,
      'utf8'
    )
    const cfg = await loadYamfConfig(d)
    await assert(cfg?.services?.[0]?.registeredServiceName, (x) => x === 'winner')
    await assert(cfg?.services?.[0]?.replicaKey, (x) => x === undefined)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

export async function testLoadYamfConfigLeavesOptionalRegisteredServiceNameUnset () {
  const d = mkdtempSync(join(tmpdir(), 'yamf-cfg-min-'))
  try {
    writeFileSync(
      join(d, 'yamf.config.mjs'),
      `export default {
  root: '.',
  services: [{ name: 'only', entry: 'e.js', replicas: 1 }],
  build: { packages: 'external' }
}
`,
      'utf8'
    )
    const cfg = await loadYamfConfig(d)
    await assert(cfg?.services?.[0]?.name, (x) => x === 'only')
    await assert(cfg?.services?.[0]?.registeredServiceName, (x) => x === undefined)
    await assert(cfg?.build?.packages, (x) => x === 'external')
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}
