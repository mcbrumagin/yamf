import { assert, withEnv } from '@yamf/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_LOCAL_REGISTRY_URL,
  resolveLocalRegistryUrl
} from '../lib/registry-url.js'

export async function testResolveLocalRegistryUrlPrefersEnv () {
  await withEnv({ YAMF_REGISTRY_URL: 'http://127.0.0.1:4444' }, async () => {
    const out = resolveLocalRegistryUrl()
    await assert(out.registryUrl, (u) => u === 'http://127.0.0.1:4444')
    await assert(out.source, (s) => s === 'env')
  })
}

export async function testResolveLocalRegistryUrlUsesPm3StateWhenEnvMissing () {
  const home = mkdtempSync(join(tmpdir(), 'yamf-registry-url-'))
  try {
    mkdirSync(join(home, 'pm3'), { recursive: true })
    writeFileSync(
      join(home, 'pm3', 'state.json'),
      JSON.stringify({ registryUrl: 'http://127.0.0.1:4000', processes: {} }, null, 2),
      'utf8'
    )
    await withEnv({ YAMF_REGISTRY_URL: undefined, YAMF_HOME: home }, async () => {
      const out = resolveLocalRegistryUrl()
      await assert(out.registryUrl, (u) => u === 'http://127.0.0.1:4000')
      await assert(out.source, (s) => s === 'pm3-state')
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

export async function testResolveLocalRegistryUrlFallsBackToDefault () {
  const home = mkdtempSync(join(tmpdir(), 'yamf-registry-url-'))
  try {
    await withEnv({ YAMF_REGISTRY_URL: undefined, YAMF_HOME: home }, async () => {
      const out = resolveLocalRegistryUrl()
      await assert(out.registryUrl, (u) => u === DEFAULT_LOCAL_REGISTRY_URL)
      await assert(out.source, (s) => s === 'default')
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
