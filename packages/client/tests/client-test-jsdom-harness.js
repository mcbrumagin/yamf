/**
 * Shared JSDOM + globals for @yamf/client tests (patch-dom, ssr-hydrate).
 * morphdom needs global HTMLElement/Node to match JSDOM nodes.
 */
import { JSDOM } from 'jsdom'

export function installJSDOM (html = '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>') {
  const dom = new JSDOM(html, { url: 'http://localhost/' })
  const w = dom.window
  if (!w.requestAnimationFrame) {
    w.requestAnimationFrame = (fn) => w.setTimeout(fn, 0)
  }
  globalThis.window = w
  globalThis.document = w.document
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w)
  }
  globalThis.HTMLElement = w.HTMLElement
  globalThis.Node = w.Node
  return () => {
    delete globalThis.HTMLElement
    delete globalThis.Node
    if (globalThis.window === w) {
      delete globalThis.window
    }
    if (globalThis.document === w.document) {
      delete globalThis.document
    }
  }
}
