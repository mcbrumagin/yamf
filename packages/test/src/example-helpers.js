import { createServer } from 'node:net'
import { registryServer } from '@yamf/core'
import { terminateAfter } from './helpers.js'

/**
 * Returns an ephemeral TCP port on 127.0.0.1 for examples/tests that must avoid
 * fixed ports (EADDRINUSE / drain races).
 * @returns {Promise<number>}
 */
export async function pickListenPort () {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : null
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

/**
 * Run a test body with a local registry and optional service factories (thunks).
 * Same argument order as {@link terminateAfter}: `() => registryServer()`, `() => createX()`, …, `async (reg, x) => {}`.
 * @param  {...(function|function[])} serviceFactoriesAndTestFn
 */
export async function withInlineRegistry (...args) {
  return terminateAfter(() => registryServer(), ...args)
}
