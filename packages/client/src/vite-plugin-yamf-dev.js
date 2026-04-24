/**
 * Vite dev-server plugin: debounced publish to `PUBSUB_CHANNEL_YAMF_DEV_RELOAD` on HMR
 * so `@yamf/services-dev-hmr` can broadcast `reload` to every browser, same as `yamf dev`
 * after a service deploy (ROADMAP Phase 4 D3).
 *
 * Requires the Vite process to have `YAMF_REGISTRY_URL` (and `YAMF_REGISTRY_TOKEN` if your
 * registry enforces it). Set `YAMF_DEV=on` and run `yamf init --dev` with the same env so the
 * registry and `yamf-dev` SSE are reachable.
 *
 * @example
 * // vite.config.js
 * import { yamfVitePluginDev } from '@yamf/client/vite-plugin-yamf-dev'
 * export default {
 *   plugins: [yamfVitePluginDev()]
 * }
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled=process.env.YAMF_DEV==='on'] - set `false` to disable
 * @param {number} [options.debounceMs=120] - coalesce bursty HMR invalidations
 * @param {(file: string) => boolean} [options.filter] - return false to ignore a file (default: skip node_modules and .git)
 * @returns {import('vite').Plugin}
 */
import { publishMessage, PUBSUB_CHANNEL_YAMF_DEV_RELOAD } from '@yamf/core'

export function yamfVitePluginDev (options = {}) {
  const {
    enabled = process.env.YAMF_DEV === 'on',
    debounceMs = 120,
    filter = (file) => typeof file === 'string' && !file.includes('node_modules') && !file.includes('/.git/')
  } = options

  let timer = null
  let tail = Promise.resolve()

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      tail = tail.then(async () => {
        if (!process.env.YAMF_REGISTRY_URL) {
          if (process.env.YAMF_VITE_DEV_LOG === '1') {
            console.warn('[yamf-vite-plugin-dev] YAMF_REGISTRY_URL is not set; skipping yamf:dev-reload publish')
          }
          return
        }
        try {
          await publishMessage(PUBSUB_CHANNEL_YAMF_DEV_RELOAD, {
            source: 'vite',
            at: Date.now()
          })
        } catch (e) {
          if (process.env.YAMF_VITE_DEV_LOG === '1') {
            console.warn('[yamf-vite-plugin-dev]', e?.message || e)
          }
        }
      })
    }, debounceMs)
  }

  return {
    name: 'yamf-dev-vite',
    apply: 'serve',
    /**
     * @param {import('vite').HmrContext} ctx
     */
    async handleHotUpdate (ctx) {
      if (!enabled) return
      if (!ctx?.file || !filter(String(ctx.file))) return
      schedule()
    }
  }
}
