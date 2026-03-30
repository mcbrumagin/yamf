/**
 * DOM patching via morphdom + YAMF inline listener lifecycle.
 * Call beginListenerGeneration() immediately before building HTML that registers
 * new yamf.__listeners__ entries (e.g. before Element.render()).
 */
import morphdom from 'morphdom'
import { getYamf } from './client-init.js'

/** @param {Element} el */
function isFormControl(el) {
  const t = el && el.tagName
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'
}

/**
 * Track elements currently under pointer interaction so morphdom skips them.
 * Range inputs (and other controls) don't always become activeElement on click/drag,
 * but replacing them mid-gesture kills the drag and resets value.
 */
const interactedElements = new WeakSet()

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (e.target && isFormControl(e.target)) {
      interactedElements.add(e.target)
      const clear = () => {
        interactedElements.delete(e.target)
        window.removeEventListener('pointerup', clear, true)
        window.removeEventListener('pointercancel', clear, true)
      }
      window.addEventListener('pointerup', clear, true)
      window.addEventListener('pointercancel', clear, true)
    }
  }, true)
}

const LISTENER_RE = /yamf\.__listeners__\[(\d+)\]/g

/**
 * Increment render generation so new handler registrations are tagged (see __listenerMeta__).
 */
export function beginListenerGeneration() {
  const yamf = getYamf()
  yamf.__listenerGeneration__ = (yamf.__listenerGeneration__ ?? 0) + 1
}

/**
 * Remove yamf.__listeners__ entries not referenced by any on* attribute in the document.
 * @param {ParentNode} [root] - defaults to document.body
 */
export function sweepOrphanedYamfListeners(root) {
  if (typeof document === 'undefined') return

  const scanRoot = root ?? document.body
  if (!scanRoot) return

  const yamf = getYamf()
  if (!yamf.__listeners__) return

  const referenced = new Set()

  /** @param {Attr} attr */
  const scanValue = (val) => {
    if (!val) return
    LISTENER_RE.lastIndex = 0
    let m
    while ((m = LISTENER_RE.exec(val)) !== null) {
      referenced.add(m[1])
    }
  }

  /** @param {Element} el */
  const scanEl = (el) => {
    if (!el.attributes) return
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i]
      if (/^on/i.test(attr.name)) scanValue(attr.value)
    }
  }

  if (scanRoot.nodeType === 1) {
    scanEl(/** @type {Element} */ (scanRoot))
    scanRoot.querySelectorAll('*').forEach(scanEl)
  }

  for (const key of Object.keys(yamf.__listeners__)) {
    if (!/^\d+$/.test(key)) continue
    if (!referenced.has(key)) {
      delete yamf.__listeners__[key]
      if (yamf.__listenerMeta__) delete yamf.__listenerMeta__[key]
    }
  }
}

/**
 * @param {any} container
 * @returns {boolean}
 */
function isElementNode(container) {
  return Boolean(
    container &&
    typeof container.nodeType === 'number' &&
    container.nodeType === 1 &&
    typeof container.cloneNode === 'function'
  )
}

/**
 * Capture window + in-container scroll so morphdom does not leave lists/views at scroll 0.
 * Only elements with `id` and non-zero scroll are restored (by id after patch).
 * @param {HTMLElement} container
 * @returns {{ docTop: number, docLeft: number, byId: Array<{ id: string, scrollTop: number, scrollLeft: number }> }}
 */
/** Known regions that scroll but may be outside a nested patch target (e.g. list column vs #trackList). */
const EXTRA_SCROLL_IDS = [
  'homeTrackListColumn',
  'trackDetailSidebarBody',
  'search-page-container',
  'main-content',
]

function captureScrollAnchor(container) {
  const doc = document.scrollingElement || document.documentElement
  const byId = []
  const seen = new Set()
  const push = (id, scrollTop, scrollLeft) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    byId.push({ id, scrollTop, scrollLeft })
  }
  // Patch root may be the scrolling element (overflow on <main>, etc.)
  if (isElementNode(container) && container.id && (container.scrollTop > 0 || container.scrollLeft > 0)) {
    push(container.id, container.scrollTop, container.scrollLeft)
  }
  if (container && typeof container.querySelectorAll === 'function') {
    for (const node of container.querySelectorAll('[id]')) {
      if (node === container) continue
      if (node.scrollTop > 0 || node.scrollLeft > 0) {
        push(node.id, node.scrollTop, node.scrollLeft)
      }
    }
  }
  for (const id of EXTRA_SCROLL_IDS) {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null
    if (el && (el.scrollTop > 0 || el.scrollLeft > 0)) {
      push(id, el.scrollTop, el.scrollLeft)
    }
  }
  return {
    docTop: doc ? doc.scrollTop : 0,
    docLeft: doc ? doc.scrollLeft : 0,
    byId,
  }
}

/** @param {ReturnType<typeof captureScrollAnchor>} anchor */
function restoreScrollAnchor(anchor) {
  const doc = document.scrollingElement || document.documentElement
  if (doc) {
    doc.scrollTop = anchor.docTop
    doc.scrollLeft = anchor.docLeft
  }
  for (const s of anchor.byId) {
    const el = document.getElementById(s.id)
    if (el) {
      el.scrollTop = s.scrollTop
      el.scrollLeft = s.scrollLeft
    }
  }
}

/**
 * Replace container's children to match the given HTML string using morphdom.
 * Does not call beginListenerGeneration — do that before producing htmlString.
 *
 * @param {HTMLElement} container
 * @param {string} htmlString
 * @param {{ skipSweep?: boolean }} [options]
 */
export function patchDOM(container, htmlString, options = {}) {
  const { skipSweep = false } = options
  if (!container || typeof document === 'undefined') return

  const html = htmlString == null ? '' : String(htmlString)

  // Tests and non-browser stubs use plain { innerHTML } objects without a real DOM
  if (!isElementNode(container)) {
    container.innerHTML = html
    if (!skipSweep && typeof document.body !== 'undefined' && document.body) {
      sweepOrphanedYamfListeners(document.body)
    }
    return
  }

  const temp = document.createElement('div')
  temp.innerHTML = html

  const scrollAnchor = captureScrollAnchor(container)

  morphdom(container, temp, {
    childrenOnly: true,
    onBeforeElUpdated(fromEl, _toEl) {
      if (isFormControl(fromEl) && (fromEl === document.activeElement || interactedElements.has(fromEl))) {
        return false
      }
      return true
    },
  })

  if (!skipSweep) sweepOrphanedYamfListeners(document.body)

  // Restore after morph + sweep. Two rAFs: first after style/layout, second after scroll anchoring / late layout.
  requestAnimationFrame(() => {
    restoreScrollAnchor(scrollAnchor)
    requestAnimationFrame(() => restoreScrollAnchor(scrollAnchor))
  })
}
