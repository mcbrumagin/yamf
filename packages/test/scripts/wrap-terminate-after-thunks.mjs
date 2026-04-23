/**
 * Wraps each `terminateAfter` *server* argument in `() =>` so work starts *inside* terminateAfter
 * (not during JavaScript's eager argument evaluation).
 * Run: node yamf/packages/test/scripts/wrap-terminate-after-thunks.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const YAMF_ROOT = process.argv[2] || path.resolve(import.meta.dirname, '../../../..')
const AVOID_DIRS = new Set(['node_modules', 'dist', '.git'])

function* walkDir(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (AVOID_DIRS.has(name.name)) {
      continue
    }
    const p = path.join(dir, name.name)
    if (name.isDirectory()) {
      yield* walkDir(p)
    } else if (name.name.endsWith('.js')) {
      yield p
    }
  }
}

function indexOfMatchingClose(src, openIdx) {
  if (src[openIdx] !== '(') {
    return -1
  }
  const n = src.length
  let i = openIdx + 1
  let depth = 1
  let inS = null
  for (; i < n; i++) {
    const c = src[i]
    if (inS) {
      if (inS === 'template') {
        if (c === '`') {
          inS = null
          continue
        }
        if (c === '\\') {
          i++
        }
        continue
      }
      if (c === '\\' && (inS === '"' || inS === "'")) {
        i++
        continue
      }
      if (c === inS) {
        inS = null
        continue
      }
      if (c === '\n' && inS === "'") {
        inS = null
      }
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      i += 2
      while (i < n && src[i] !== '\n') {
        i++
      }
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i + 1 < n && (src[i] !== '*' || src[i + 1] !== '/')) {
        i++
      }
      i++
      continue
    }
    if (c === "'" || c === '"') {
      inS = c
      continue
    }
    if (c === '`') {
      inS = 'template'
      continue
    }
    if (c === '(') {
      depth++
    } else if (c === ')') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

function findLastArgComma(inner) {
  const n = inner.length
  let i = 0
  let depthP = 0
  let depthB = 0
  let depthC = 0
  let inS = null
  let lastComma = -1
  for (; i < n; i++) {
    const c = inner[i]
    if (inS) {
      if (inS === 'template') {
        if (c === '\\') {
          i++
          continue
        }
        if (c === '`') {
          inS = null
          continue
        }
        if (c === '$' && inner[i + 1] === '{') {
          depthC++
          i++
        }
        continue
      }
      if (c === '\\' && (inS === '"' || inS === "'")) {
        i++
        continue
      }
      if (c === inS) {
        inS = null
        continue
      }
      if (c === '\n' && inS === "'") {
        inS = null
      }
      continue
    }
    if (c === '/' && inner[i + 1] === '/') {
      i += 2
      while (i < n && inner[i] !== '\n') {
        i++
      }
      continue
    }
    if (c === '/' && inner[i + 1] === '*') {
      i += 2
      while (i + 1 < n && (inner[i] !== '*' || inner[i + 1] !== '/')) {
        i++
      }
      i++
      continue
    }
    if (c === "'" || c === '"') {
      inS = c
      continue
    }
    if (c === '`') {
      inS = 'template'
      continue
    }
    if (c === '{') {
      depthC++
    } else if (c === '}' && depthC > 0) {
      depthC--
    } else if (c === '(') {
      depthP++
    } else if (c === ')' && depthP > 0) {
      depthP--
    } else if (c === '[') {
      depthB++
    } else if (c === ']' && depthB > 0) {
      depthB--
    } else if (c === ',' && depthP === 0 && depthB === 0 && depthC === 0) {
      lastComma = i
    }
  }
  return lastComma
}

function splitOnTopLevelCommas(s) {
  const n = s.length
  let i = 0
  let start = 0
  const parts = []
  let depthP = 0
  let depthB = 0
  let depthC = 0
  let inS = null
  for (; i < n; i++) {
    const c = s[i]
    if (inS) {
      if (inS === 'template') {
        if (c === '\\') {
          i++
          continue
        }
        if (c === '`') {
          inS = null
          continue
        }
        if (c === '$' && s[i + 1] === '{') {
          depthC++
          i++
        }
        continue
      }
      if (c === '\\' && (inS === '"' || inS === "'")) {
        i++
        continue
      }
      if (c === inS) {
        inS = null
        continue
      }
      if (c === '\n' && inS === "'") {
        inS = null
      }
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      i += 2
      while (i < n && s[i] !== '\n') {
        i++
      }
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2
      while (i + 1 < n && (s[i] !== '*' || s[i + 1] !== '/')) {
        i++
      }
      i++
      continue
    }
    if (c === "'" || c === '"') {
      inS = c
      continue
    }
    if (c === '`') {
      inS = 'template'
      continue
    }
    if (c === '{') {
      depthC++
    } else if (c === '}' && depthC > 0) {
      depthC--
    } else if (c === '(') {
      depthP++
    } else if (c === ')' && depthP > 0) {
      depthP--
    } else if (c === '[') {
      depthB++
    } else if (c === ']' && depthB > 0) {
      depthB--
    } else if (c === ',' && depthP === 0 && depthB === 0 && depthC === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start, n))
  return parts
}

function shouldWrapPrefix(t) {
  if (t.startsWith('() =>')) {
    return false
  }
  if (t.startsWith('async ')) {
    return false
  }
  return true
}

function wrapSegment(seg) {
  const t = seg.replace(/^\s+/, '')
  if (!shouldWrapPrefix(t)) {
    return seg
  }
  return seg.replace(/^(\s*)(?=\S)/, '$1() => ')
}

function processFile(filePath) {
  if (filePath.includes(`${path.sep}helpers.js`)) {
    return false
  }
  const original = fs.readFileSync(filePath, 'utf8')
  if (!original.includes('terminateAfter(')) {
    return false
  }
  let content = original
  const re = /\bterminateAfter\s*\(/g
  const ranges = []
  let m
  while ((m = re.exec(content)) !== null) {
    const openParen = m.index + m[0].length - 1
    if (content[openParen] !== '(') {
      continue
    }
    const closeIdx = indexOfMatchingClose(content, openParen)
    if (closeIdx < 0) {
      continue
    }
    ranges.push({ openParen, closeIdx, innerFrom: openParen + 1, innerTo: closeIdx })
  }
  for (const r of ranges.sort((a, b) => b.openParen - a.openParen)) {
    const inner = content.slice(r.innerFrom, r.innerTo)
    const last = findLastArgComma(inner)
    if (last < 0) {
      continue
    }
    const serverPart = inner.slice(0, last)
    const testPart = inner.slice(last + 1)
    const segs = splitOnTopLevelCommas(serverPart)
    const newSegs = segs.map(s => {
      if (!s.trim()) {
        return s
      }
      return wrapSegment(s)
    })
    let newServer = newSegs.join(',')
    // `() => await foo` is a syntax error (non-async arrow); thunks return the promise from `foo` directly
    newServer = newServer.replace(/\(\s*\)\s*=>\s*await\s+/g, '() => ')
    if (newServer === serverPart) {
      continue
    }
    content =
      content.slice(0, r.openParen + 1) + newServer + ',' + testPart + content.slice(r.closeIdx)
  }
  if (content === original) {
    return false
  }
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

const root = path.join(YAMF_ROOT, 'yamf')
if (!fs.existsSync(root)) {
  console.error('Expected yamf at', root, '— pass repo root (parent of yamf) as first argument')
  process.exit(1)
}

let n = 0
for (const f of walkDir(root)) {
  if (processFile(f)) {
    console.log('updated', path.relative(root, f))
    n++
  }
}
console.log('files updated:', n)
