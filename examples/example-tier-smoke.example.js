/**
 * Top-level `examples/` tier: runnable without workspace `node_modules` in `examples/`
 * (integration runs this via `yamf test --as-test` from the monorepo root).
 */
import { createServer } from 'node:net'

const port = await new Promise((resolve, reject) => {
  const s = createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => {
    const addr = s.address()
    const p = typeof addr === 'object' && addr != null ? addr.port : 0
    s.close((err) => (err ? reject(err) : resolve(p)))
  })
})

if (typeof port !== 'number' || port < 1 || port > 65535) {
  console.error('unexpected listen port:', port)
  process.exit(1)
}
console.log('examples tier: ephemeral port', port)
