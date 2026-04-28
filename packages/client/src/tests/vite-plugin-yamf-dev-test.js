import { assert } from '@yamf/test'
import { yamfVitePluginDev } from '../vite-plugin-yamf-dev.js'

export async function testYamfVitePluginDevShape () {
  const p = yamfVitePluginDev({ enabled: false })
  await assert(p?.name, (n) => n === 'yamf-dev-vite')
  await assert(p?.apply, (a) => a === 'serve')
  await assert(typeof p?.handleHotUpdate, (t) => t === 'function')
}
