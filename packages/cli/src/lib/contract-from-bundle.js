/**
 * Cross-cut 2: load the service contract the bundle would register, without starting HTTP.
 * Relies on {@link createService} returning early when YAMF_EXTRACT_SERVICE_CONTRACT is set.
 *
 * The deploy child gets `YAMF_ENTRY_DIR` from planAndApply; this import runs in the **CLI** process
 * and must set the same so entries that resolve static paths (e.g. `public/`) do not use
 * `import.meta` under `.yamf/build/`.
 */

import { pathToFileURL } from 'node:url'
import { envConfig } from '@yamf/core'

/**
 * @param {string} bundlePath - absolute or cwd-relative path to the built .mjs
 * @param {Object} [opts]
 * @param {string} [opts.yamfEntryDir] - absolute path to the service entry directory (e.g. …/src/app), same as planAndApply’s child env
 * @returns {Promise<object|null>}
 */
export async function loadIncomingServiceContractFromBundle (bundlePath, opts = {}) {
  const { yamfEntryDir } = opts
  const prevExtract = envConfig.get('YAMF_EXTRACT_SERVICE_CONTRACT')
  const prevEntryDir = process.env.YAMF_ENTRY_DIR
  const prevEntryDirConfig = envConfig.get('YAMF_ENTRY_DIR')
  envConfig.set('YAMF_EXTRACT_SERVICE_CONTRACT', '1')
  if (yamfEntryDir) {
    process.env.YAMF_ENTRY_DIR = yamfEntryDir
    envConfig.set('YAMF_ENTRY_DIR', yamfEntryDir)
  }
  try {
    const url = `${pathToFileURL(bundlePath).href}?x=${Date.now()}`
    const mod = await import(url)
    const fn = mod.default
    if (typeof fn !== 'function') {
      throw new Error('Bundle must default-export an async function (YAMF service entry)')
    }
    const out = await fn()
    if (!out || !out.yamfContractExtract) {
      throw new Error(
        'Could not extract service contract: entry did not complete createService() in extract mode. ' +
          'Avoid side effects before createService in the default export, or disable contract checks for this deploy.'
      )
    }
    return out.contract ?? null
  } finally {
    if (prevExtract !== undefined) {
      envConfig.set('YAMF_EXTRACT_SERVICE_CONTRACT', prevExtract)
    } else {
      envConfig.set('YAMF_EXTRACT_SERVICE_CONTRACT', null)
    }
    if (yamfEntryDir) {
      if (prevEntryDir !== undefined) {
        process.env.YAMF_ENTRY_DIR = prevEntryDir
      } else {
        delete process.env.YAMF_ENTRY_DIR
      }
      if (prevEntryDirConfig !== undefined) {
        envConfig.set('YAMF_ENTRY_DIR', prevEntryDirConfig)
      } else {
        envConfig.set('YAMF_ENTRY_DIR', null)
      }
    }
  }
}
