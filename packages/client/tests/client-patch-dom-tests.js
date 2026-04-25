/**
 * @yamf/client `patch-dom.js` — Node stubs + JSDOM/morphdom.
 */
import { assert } from '@yamf/test'
import { getYamf } from '../src/client-init.js'
import { beginListenerGeneration, patchDOM, sweepOrphanedYamfListeners } from '../src/patch-dom.js'
import { installJSDOM } from './client-test-jsdom-harness.js'

export async function testBeginListenerGenerationIncrements () {
  const y = getYamf()
  const n = (y.__listenerGeneration__ ?? 0)
  beginListenerGeneration()
  beginListenerGeneration()
  await assert(y.__listenerGeneration__, (g) => g === n + 2)
}

export async function testSweepOrphanedYamfListenersNoDocumentNoops () {
  const prev = globalThis.document
  try {
    delete globalThis.document
    sweepOrphanedYamfListeners()
    await assert(true, (x) => x)
  } finally {
    if (prev !== undefined) {
      globalThis.document = prev
    }
  }
}

export async function testPatchDomPlainContainerSetsInnerHtml () {
  const prev = globalThis.document
  try {
    globalThis.document = { body: null }
    const c = { innerHTML: '' }
    patchDOM(c, '<em>x</em>')
    await assert(c.innerHTML, (h) => h.includes('<em>x</em>'))
  } finally {
    if (prev === undefined) {
      delete globalThis.document
    } else {
      globalThis.document = prev
    }
  }
}

export async function testPatchDomMorphsContainerChildren () {
  const restore = installJSDOM()
  try {
    const root = document.getElementById('root')
    root.innerHTML = '<span>old</span>'
    patchDOM(root, '<span>new</span>')
    await assert(root.textContent, (t) => t.includes('new'))
  } finally {
    restore()
  }
}
