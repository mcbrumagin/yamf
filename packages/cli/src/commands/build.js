import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// Programmatic `esbuild.build()`: reproducible, no shell quoting issues. Same binary as the CLI; only difference is in-process API vs child process.
import esbuild from 'esbuild'
import { Logger } from '@yamf/core'
import parseArgs from '../lib/parse-args.js'
import { loadYamfConfig } from '../lib/load-yamf-config.js'
import { computeBundleHash, hashInputsFromMetafile } from '../lib/bundle-hash.js'
import { getServiceBuildDir, getYamfHome, getBuildIndexPath } from '../lib/yamf-paths.js'

const logger = new Logger()
const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILDER_VERSION = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf8')
).version

const ARGS = {
  help: { flags: ['-h', '--help'] },
  all: { flags: ['-a', '--all'] }
}

function getBuildHelp () {
  return `
yamf build - Bundle service entries with esbuild and cache under .yamf/build/

Usage:
  yamf build [service-name] [options]

Requires yamf.config.js in the current directory (see yamf/docs/ROADMAP.md Phase 2).

Options:
  -a, --all      Build all non-internal services from the manifest
  -h, --help     Show this help
`
}

/**
 * @param {import('../lib/load-yamf-config.js').YamfConfig} cfg
 * @param {import('../lib/load-yamf-config.js').YamfConfigService} svc
 * @param {string} cwd
 */
export async function buildServiceEntry (cfg, svc, cwd = process.cwd()) {
  const root = resolve(cwd, cfg.root || '.')
  const entryAbs = resolve(root, svc.entry)
  if (!existsSync(entryAbs)) {
    throw new Error(`Entry not found: ${entryAbs} (service "${svc.name}")`)
  }
  const external = [...new Set([...(cfg.build?.external || []), '@yamf/*'])]
  const result = await esbuild.build({
    entryPoints: [entryAbs],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: cfg.build?.target || 'node20',
    sourcemap: cfg.build?.sourcemap !== false,
    external,
    write: false,
    metafile: true,
    absWorkingDir: root
  })
  if (!result.outputFiles?.[0]) {
    throw new Error(`esbuild produced no output for ${svc.name}`)
  }
  const bytes = result.outputFiles[0].contents
  const deps = hashInputsFromMetafile(result.metafile?.inputs, root)
  const hash = computeBundleHash(bytes, {
    entry: svc.entry,
    env: svc.env || [],
    deps,
    nodeTarget: cfg.build?.target || 'node20',
    builderVersion: BUILDER_VERSION
  })
  const outDir = getServiceBuildDir(svc.name, cwd)
  mkdirSync(outDir, { recursive: true })
  const bundleFile = join(outDir, `${hash}.mjs`)
  writeFileSync(bundleFile, bytes)
  const meta = {
    entry: svc.entry,
    env: [...(svc.env || [])].sort(),
    deps,
    nodeTarget: cfg.build?.target || 'node20',
    builderVersion: BUILDER_VERSION,
    createdAt: new Date().toISOString()
  }
  writeFileSync(join(outDir, `${hash}.meta.json`), JSON.stringify(meta, null, 2) + '\n', {
    mode: 0o644
  })
  writeFileSync(
    join(outDir, 'latest.json'),
    JSON.stringify({ hash, createdAt: meta.createdAt }, null, 2) + '\n',
    { mode: 0o644 }
  )
  logger.info(`Built ${svc.name} → ${hash}`)
  return { name: svc.name, hash, bundleFile }
}

/**
 * @param {string[]} args
 */
export async function runBuildCommand (args) {
  const options = parseArgs(args, ARGS)
  if (options.help) {
    console.log(getBuildHelp())
    return
  }
  const cfg = await loadYamfConfig()
  if (!cfg || !cfg.services?.length) {
    throw new Error('yamf.config.js with a non-empty `services` array is required. See yamf/docs/ROADMAP.md (Phase 2).')
  }
  const cwd = process.cwd()
  getYamfHome(cwd) // ensure dir exists

  const positional = options._positional
  const wantAll = options.all
  const name = positional[0]
  if (!name && !wantAll) {
    throw new Error('Pass a service name, or use --all to build every non-internal service')
  }
  const candidates = wantAll
    ? cfg.services.filter((s) => !s.internal)
    : cfg.services.filter((s) => s.name === name)
  if (!candidates.length) {
    throw new Error(wantAll ? 'No non-internal services in yamf.config.js' : `Unknown service "${name}" in yamf.config.js`)
  }

  const index = {}
  for (const svc of candidates) {
    if (svc.internal) continue
    const { hash } = await buildServiceEntry(cfg, svc, cwd)
    index[svc.name] = hash
  }
  const indexPath = getBuildIndexPath(cwd)
  mkdirSync(dirname(indexPath), { recursive: true })
  const prev = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {}
  const merged = { ...(prev.services && typeof prev.services === 'object' ? prev.services : {}), ...index }
  writeFileSync(
    indexPath,
    JSON.stringify({ services: merged, updatedAt: new Date().toISOString() }, null, 2) + '\n'
  )
  logger.info(`Wrote ${indexPath}`)
}
