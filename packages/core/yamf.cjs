#!/usr/bin/env node

const cliArgs = require('./src/utils/cli-parser.cjs')
const { callService, publishMessage, Logger } = require('./src/index.js')
const httpRequest = require('./src/index.js').httpRequest

const logger = new Logger({ logGroup: 'yamf-cli', includeLogLineNumbers: false })

// logger.debug({cliArgs})

/* TODO simple process management

- create process
- list processes
- kill process
*/

async function main() {
  let [ command, target, payload ] = cliArgs.args

  if (command === 'call') {
    logger.debug({service: target, payload})

    try {
      payload = JSON.parse(payload)
    } catch (err) {
      try {
        // TODO implement a safer way to parse a shorthand payload
        // as cool as this is, it's a security risk, even for a CLI tool
        payload = eval(`payload = ${payload}`) // helper to avoid death by quotes
      } catch (err) { /* ignore */ }
    }

    logger.debug({payload})
    if (!target || !payload) throw new Error('Please provide "service" and "payload" arguments')
    logger.info('result:', await callService(target, payload))
  }
  else if (command === 'publish' || command === 'pub') {
    logger.debug({channel: target, message: payload})

    try {
      payload = JSON.parse(payload)
    } catch (err) {
      try {
        // TODO
        payload = eval(`payload = ${payload}`) // helper to avoid death by quotes
      } catch (err) { /* ignore */ }
    }

    logger.debug({message: payload})
    if (!target || !payload) throw new Error('Please provide "channel" and "message" arguments')
    const result = await publishMessage(target, payload)
    logger.info('published to', result.results?.length || 0, 'subscriber(s)')
    logger.info('result:', result)
  }
  else if (command === 'registry') {
    // logger.debug({command, target, payload})
    try {
      payload = JSON.parse(payload)
    } catch (err) {
      try {
        // TODO
        payload = eval(`payload = ${payload}`) // helper to avoid death by quotes
      } catch (err) { /* ignore */ }
    }

    let url = `${process.env.MICRO_REGISTRY_URL}${target}`
    logger.debug({url, payload})
    // const response = await fetch(url, {
    //   method: 'POST',
    //   body: JSON.stringify(payload)
    // })

    let result = await httpRequest(url, {
      payload
    })
    logger.info(`registry response [${result?.status}]: ${JSON.stringify(result)}`)

  }
  else throw new Error('Invalid command. Use "call" or "publish"')
}

main().catch(err => logger.error(err))
