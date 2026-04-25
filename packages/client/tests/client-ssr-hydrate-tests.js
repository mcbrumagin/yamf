/**
 * @yamf/client `ssr-hydrate.js` — serializeSsrEvent, installSsrInvoke, installSsrRenderFromEventSource (JSDOM).
 */
import { assert } from '@yamf/test'
import { getYamf } from '../src/client-init.js'
import { serializeSsrEvent, installSsrInvoke, installSsrRenderFromEventSource } from '../src/ssr-hydrate.js'
import { installJSDOM } from './client-test-jsdom-harness.js'

export async function testSerializeSsrEventUndefinedIsClick () {
  const o = serializeSsrEvent(undefined)
  await assert(o, (x) => x.type === 'click')
}

export async function testSerializeSsrEventTargetWithId () {
  const o = serializeSsrEvent({
    type: 'submit',
    target: { nodeType: 1, tagName: 'INPUT', id: 'email', value: 'a@b.c', checked: false, getAttribute: () => null, dataset: {} }
  })
  await assert(o, (x) => x.type === 'submit' && x.targetSel === '#email' && x.value === 'a@b.c')
}

export async function testSerializeSsrEventDataYamfTarget () {
  const o = serializeSsrEvent({
    type: 'click',
    target: {
      nodeType: 1,
      tagName: 'DIV',
      id: '',
      getAttribute: (n) => (n === 'data-yamf-target' ? 'foo"bar' : null),
      value: undefined,
      checked: undefined,
      dataset: { x: '1' }
    }
  })
  await assert(
    o,
    (x) => x.type === 'click' && /\[data-yamf-target=/.test(x.targetSel)
  )
}

export async function testSerializeSsrEventNonElementTarget () {
  const o = serializeSsrEvent({ type: 'load', target: { nodeType: 3 } })
  await assert(o, (x) => x.type === 'load' && !x.targetSel)
}

export async function testInstallSsrInvokeWithoutWindowIsNoop () {
  const prevW = globalThis.window
  const prevD = globalThis.document
  try {
    delete globalThis.window
    delete globalThis.document
    const u = installSsrInvoke()
    await assert({ u }, (o) => typeof o.u === 'function')
    u()
  } finally {
    if (prevW !== undefined) {
      globalThis.window = prevW
    } else {
      delete globalThis.window
    }
    if (prevD !== undefined) {
      globalThis.document = prevD
    } else {
      delete globalThis.document
    }
  }
}

export async function testInstallSsrRenderFromEventSourceAppliesPatch () {
  const restore = installJSDOM()
  try {
    document.body.innerHTML = '<div id="main">a</div>'
    const fake = {
      _h: null,
      addEventListener (name, h) {
        this._h = h
      },
      removeEventListener () {}
    }
    const u = installSsrRenderFromEventSource(fake)
    fake._h({
      data: JSON.stringify({ patch: '<div id="main">b</div>', target: '#main' })
    })
    await assert(document.getElementById('main').textContent, (t) => t.trim() === 'b')
    u()
  } finally {
    restore()
  }
}

export async function testInstallSsrRenderFromEventSourceSkipsNoPatch () {
  const restore = installJSDOM()
  try {
    const body = document.body
    const before = body.innerHTML
    const fake = { _h: null, addEventListener (n, h) { this._h = h }, removeEventListener () {} }
    installSsrRenderFromEventSource(fake)
    fake._h({ data: JSON.stringify({ nope: 1 }) })
    await assert(body.innerHTML, (h) => h === before)
  } finally {
    restore()
  }
}

export async function testInstallSsrInvokeFetchesAndPatches () {
  const restore = installJSDOM()
  const prevFetch = globalThis.fetch
  try {
    document.body.innerHTML = '<div id="patch-root">0</div>'
    const calls = []
    globalThis.fetch = async (url) => {
      calls.push(String(url))
      return {
        status: 200,
        headers: { get: (name) => (name === 'content-type' ? 'application/json' : null) },
        json: async () => ({ patch: '<div id="patch-root">1</div>', target: '#patch-root' })
      }
    }
    const y = getYamf()
    const prev = y.invoke
    const u = installSsrInvoke({ endpoint: 'http://localhost/ssr' })
    await y.invoke('sig-1', {
      type: 'click',
      target: { nodeType: 1, tagName: 'BUTTON', id: 'go', getAttribute: () => null, value: undefined, checked: undefined, dataset: {} }
    })
    await assert(calls.length, (n) => n === 1)
    await assert(document.getElementById('patch-root').textContent, (t) => t === '1')
    u()
    y.invoke = prev
  } finally {
    globalThis.fetch = prevFetch
    restore()
  }
}

export async function testInstallSsrInvokeUninstallRestoresInvoke () {
  const restore = installJSDOM()
  const prevFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({
      status: 204
    })
    const y = getYamf()
    const before = y.invoke
    const u = installSsrInvoke({ endpoint: 'http://localhost/ssr-only-uninstall' })
    await assert({ cur: y.invoke, before }, (o) => o.cur !== o.before)
    u()
    await assert({ cur: y.invoke, before }, (o) => o.cur === o.before)
  } finally {
    globalThis.fetch = prevFetch
    restore()
  }
}
