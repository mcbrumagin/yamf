import { Logger, envConfig, envTruthy, terminateActiveRegistryServers } from '@yamf/core'

const logger = new Logger()

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function isThenable (x) {
  return x != null && typeof x.then === 'function'
}

async function terminateAfterSingleFn (fn) {
  let bodyError
  try {
    await fn()
  } catch (e) {
    bodyError = e
  } finally {
    try {
      await terminateActiveRegistryServers()
    } catch (e) {
      if (process.env.YAMF_TEST_VERBOSE_TEARDOWN != null && envTruthy(process.env.YAMF_TEST_VERBOSE_TEARDOWN)) {
        console.warn(`[terminateAfter] registry shutdown failed: ${e.message}`)
      }
    }
  }
  if (bodyError) throw bodyError
}

/**
 * Start servers, run the test, then terminate in a safe order (non-registry first, registry last).
 *
 * **Evaluation order (JavaScript):** `terminateAfter(() => registry(), () => create(), testFn)` *starts* all
 * async tasks while building the argument list, before `terminateAfter` runs—so a later `createRoute()`
 * can hit the registry before it is listening. **Pass thunks (zero-arg functions) so work starts
 * in sequence** inside this helper, e.g. `terminateAfter(() => registryServer(), () => createService('x', fn), testFn)`.
 * You can still pass an already-started Promise (a thenable) when you need parallel start
 * outside this helper's sequential `for` loop.
 *
 * - Each server item is either: a **thenable** (awaited as-is), or a **function** (called with no
 *   args; the return is awaited, then optional array flattening applies as below).
 * - A single `Promise.all([...])` can be one argument: `() => Promise.all([...])` as a thunk, or
 *   pass the Promise if you need parallel start outside the sequential `for` loop.
 *
 * @param  {...(Promise<unknown> | (() => unknown) | unknown | unknown[])} serverFns
 *   Each item may be a thenable, a no-arg factory, a value, or (after await) a non-empty `Array` of
 *   server-like objects.
 * @param {Function} testFn
 */
export async function terminateAfter (...args) {
  if (args.length === 1 && typeof args[0] === 'function') {
    return await terminateAfterSingleFn(args[0])
  }

  const testFn = args[args.length - 1]
  const serverInputs = args.slice(0, -1)
  if (typeof testFn !== 'function') {
    throw new Error('terminateAfter last argument must be a function')
  }

  const flatServers = []
  try {
    for (const item of serverInputs) {
      let toAwait
      if (isThenable(item)) {
        toAwait = item
      } else if (typeof item === 'function') {
        const out = item()
        toAwait = isThenable(out) ? out : Promise.resolve(out)
      } else {
        toAwait = Promise.resolve(item)
      }
      const resolved = await toAwait
      if (Array.isArray(resolved) && resolved.length > 0) {
        for (const s of resolved) {
          flatServers.push(s)
        }
      } else {
        flatServers.push(resolved)
      }
    }
    return await testFn(...flatServers)
  } finally {
    const registryIndex = flatServers.findIndex(s => s && s.isRegistry)
    if (registryIndex > -1) {
      const registryServer_ = flatServers[registryIndex]
      const otherServers = flatServers.filter((_, i) => i !== registryIndex)
      for (const server of otherServers) {
        if (!server) {
          continue
        }
        await server.terminate()
        logger.info(`terminated server ${server.name} at port ${server.port}`)
      }
      await registryServer_?.terminate()
      logger.info(`terminated registry server at port ${registryServer_?.port}`)
    } else {
      for (const server of flatServers) {
        if (!server) {
          continue
        }
        await server.terminate()
        logger.info(`terminated server ${server.name} at port ${server.port}`)
      }
    }
  }
}

function setEnv(key, value) {
  if (value === undefined) {
    delete process.env[key]
    envConfig.config.delete(key)
  } else {
    const str = String(value)
    process.env[key] = str
    envConfig.set(key, envConfig.parseValue(str))
  }
}

export async function withEnv(envVars, fn) {
  const saved = {}
  for (const key in envVars) {
    saved[key] = process.env[key]
    setEnv(key, envVars[key])
  }
  
  try {
    return await fn()
  } finally {
    for (const key in saved) {
      if (saved[key] === undefined) {
        setEnv(key, undefined)
      } else {
        setEnv(key, saved[key])
      }
    }
  }
}
