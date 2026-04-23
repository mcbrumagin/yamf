/**
 * Strips `await` from terminateAfter *server* arguments (pass thenables, not settled values).
 * Run from repo: node yamf/packages/test/scripts/strip-terminate-after-awaits.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

// scripts -> test -> packages -> yamf -> repo root
const YAMF_ROOT = process.argv[2] || path.resolve(import.meta.dirname, '../../../..')
const AVOID_DIRS = new Set(['node_modules', 'dist', '.git'])

const LINE_START_AWAIT = new RegExp(
  '^[ \\t]*await[ \\t]+' +
  '(' +
  [
    'registryServer',
    'createService',
    'createServices',
    'createRoute',
    'createRoutes',
    'gatewayServer',
    'createAuthService',
    'createUserService',
    'createMockPostgresService',
    'createCacheService',
    'createEventSourceService',
    'createSubscriptionService',
    'Promise\\.all',
  ].join('|') +
  ')\\b',
  'gm',
)

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

/** `(` at openIdx: find matching `)`, paren depth only, skip // /* ' " ` */
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

/** Commas that separate top-level `terminateAfter` arguments (object/array/template-aware). */
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
          continue
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
    } else if (c === ')') {
      if (depthP > 0) {
        depthP--
      }
    } else if (c === '[') {
      depthB++
    } else if (c === ']') {
      if (depthB > 0) {
        depthB--
      }
    } else if (c === ',' && depthP === 0 && depthB === 0 && depthC === 0) {
      lastComma = i
    }
  }
  return lastComma
}

function transformServerPart(serverPart) {
  let s = serverPart
  s = s.replace(
    /^([ \t]*[a-zA-Z_$][\w$]*[ \t]*=[ \t]*)await[ \t]+(create\w+|registryServer|gatewayServer|Promise\.all|createRoute|createRoutes)\b([ \t]*\()/gm,
    '$1$2$3',
  )
  s = s.replace(LINE_START_AWAIT, m => m.replace(/await\s+/, ''))
  return s
}

function processFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8')
  let content = original
  if (!content.includes('terminateAfter(')) {
    return false
  }
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
  if (ranges.length === 0) {
    return false
  }
  for (const r of ranges.sort((a, b) => b.openParen - a.openParen)) {
    const inner = content.slice(r.innerFrom, r.innerTo)
    const last = findLastArgComma(inner)
    if (last < 0) {
      continue
    }
    const serverPart = inner.slice(0, last)
    const testPart = inner.slice(last + 1)
    const fixed = transformServerPart(serverPart)
    if (fixed === serverPart) {
      continue
    }
    content =
      content.slice(0, r.openParen + 1) + fixed + ',' + testPart + content.slice(r.closeIdx)
  }
  if (content === original) {
    return false
  }
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

const root = path.join(YAMF_ROOT, 'yamf')
if (!fs.existsSync(root)) {
  console.error('Expected yamf at', root, '— pass repo root as first argument (parent of yamf).')
  process.exit(1)
}

let n = 0
for (const f of walkDir(root)) {
  if (processFile(f)) {
    console.log('updated', path.relative(path.join(YAMF_ROOT, 'yamf'), f))
    n++
  }
}
console.log('files updated:', n)
