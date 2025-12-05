import { Logger, envConfig } from '@yamf/core'

const logger = new Logger()

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function terminateAfter(...args /* ...serverFns, testFn */) {
  args.unshift(args.pop()) // rearrange for spread
  let [testFn, ...serverFns] = args
  if (typeof testFn !== 'function') throw new Error('terminateAfter last argument must be a function')
  
  let servers = []
  try {
    servers = await Promise.all(serverFns)
    for (let server of servers) {
      if (server && server.length > 0) {
        let index = servers.indexOf(server)
        servers.splice(index, 1)
        servers.push(...server)
      }
    }

    let result = await testFn(...servers)
    return result
  } finally {
    let registryIndex = servers.findIndex(s => s.isRegistry)
    if (registryIndex > -1) {
      let registryServer = servers[registryIndex]
      servers = servers.slice(0, registryIndex).concat(servers.slice(registryIndex + 1))
      for (let server of servers) {
        await server?.terminate()
        logger.info(`terminated server ${server?.name} at port ${server?.port}`)
      }
      await registryServer?.terminate()
      logger.info(`terminated registry server at port ${registryServer?.port}`)
    } else for (let server of servers) await server?.terminate()
  }
}

function setEnv(key, value) {
  if (value === undefined) {
    delete process.env[key]
    envConfig.config.delete(key)
  } else {
    process.env[key] = value
    envConfig.set(key, value)
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
