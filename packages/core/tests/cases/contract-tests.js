/**
 * Tests for runtime service contracts
 */

import {
  assert,
  assertErr,
  terminateAfter,
  sleep
} from '@yamf/test'

import {
  registryServer,
  createService,
  callService
} from '../../src/index.js'

import {
  getParamNames,
  extractDestructuredKeys,
  extractContract,
  buildContract,
  validatePayloadAgainstContract
} from '../../src/service/service-contract.js'

// ---- Unit tests: contract extraction ----

export async function testGetParamNamesBasic() {
  const params = getParamNames(function testService(payload) { return payload })
  assert(params,
    p => p.length === 1,
    p => p[0] === 'payload'
  )
}

export async function testGetParamNamesMultiple() {
  const params = getParamNames(function test(a, b, c) {})
  assert(params,
    p => p.length === 3,
    p => p[0] === 'a',
    p => p[1] === 'b',
    p => p[2] === 'c'
  )
}

export async function testGetParamNamesWithDefaults() {
  const params = getParamNames(function test(a, b = 10, c) {})
  assert(params,
    p => p.length === 3,
    p => p[0] === 'a',
    p => p[1] === 'b',
    p => p[2] === 'c'
  )
}

export async function testGetParamNamesArrowFunction() {
  const params = getParamNames((payload) => payload)
  assert(params,
    p => p.length === 1,
    p => p[0] === 'payload'
  )
}

export async function testGetParamNamesAsyncFunction() {
  const params = getParamNames(async function handler(payload) {})
  assert(params,
    p => p.length === 1,
    p => p[0] === 'payload'
  )
}

export async function testGetParamNamesNoParams() {
  const params = getParamNames(function test() {})
  assert(params, p => p.length === 0)
}

export async function testExtractDestructuredKeys() {
  const keys = extractDestructuredKeys(function test({ userId, action }) {})
  assert(keys,
    k => k.length === 2,
    k => k[0] === 'userId',
    k => k[1] === 'action'
  )
}

export async function testExtractDestructuredKeysWithDefaults() {
  const keys = extractDestructuredKeys(function test({ userId, action = 'default' }) {})
  assert(keys,
    k => k.length === 2,
    k => k[0] === 'userId',
    k => k[1] === 'action'
  )
}

export async function testExtractDestructuredKeysNonDestructured() {
  const keys = extractDestructuredKeys(function test(payload) {})
  assert(keys, k => k.length === 0)
}

export async function testExtractContractBasic() {
  const contract = extractContract(function test(payload) {})
  assert(contract,
    c => c.enforce === true,
    c => c.params.length === 1,
    c => c.params[0] === 'payload',
    c => c.expectedKeys.length === 0,
    c => c.hasDestructuring === false,
    c => c.hasRestParam === false
  )
}

export async function testExtractContractDestructured() {
  const contract = extractContract(function test({ userId, action }) {})
  assert(contract,
    c => c.enforce === true,
    c => c.hasDestructuring === true,
    c => c.expectedKeys.length === 2,
    c => c.expectedKeys[0] === 'userId',
    c => c.expectedKeys[1] === 'action'
  )
}

export async function testExtractContractRestParams() {
  const contract = extractContract(function test(...args) {})
  assert(contract,
    c => c.hasRestParam === true,
    c => c.params[0] === '...args'
  )
}

export async function testBuildContractFalse() {
  const contract = buildContract(false, function test(payload) {})
  assert(contract, c => c === null)
}

export async function testBuildContractTrue() {
  const contract = buildContract(true, function test(payload) {})
  assert(contract,
    c => c !== null,
    c => c.enforce === true,
    c => c.params[0] === 'payload'
  )
}

export async function testBuildContractCustom() {
  const contract = buildContract({ params: ['data'], expectedKeys: ['userId', 'action'] }, function test(payload) {})
  assert(contract,
    c => c.enforce === true,
    c => c.params[0] === 'data',
    c => c.expectedKeys.length === 2,
    c => c.expectedKeys[0] === 'userId',
    c => c.expectedKeys[1] === 'action'
  )
}

// ---- Unit tests: validation ----

export async function testValidatePayloadValid() {
  const contract = { enforce: true, expectedKeys: ['userId'], params: ['payload'] }
  validatePayloadAgainstContract('test', { userId: 1 }, contract)
}

export async function testValidatePayloadAllowsStringWhenNoExpectedKeys() {
  const contract = { enforce: true, expectedKeys: [], params: ['payload'] }
  validatePayloadAgainstContract('test', 'string-payload-is-fine', contract)
}

export async function testValidatePayloadRejectsStringWhenKeysExpected() {
  const contract = { enforce: true, expectedKeys: ['userId'], params: ['payload'] }
  await assertErr(
    () => validatePayloadAgainstContract('test', 'bad payload', contract),
    err => err.message.includes('payload must be a plain object'),
    err => err.message.includes('got string'),
    err => err.status === 400
  )
}

export async function testValidatePayloadRejectsNullWhenKeysExpected() {
  const contract = { enforce: true, expectedKeys: ['userId'], params: ['payload'] }
  await assertErr(
    () => validatePayloadAgainstContract('test', null, contract),
    err => err.message.includes('got null')
  )
}

export async function testValidatePayloadRejectsArrayWhenKeysExpected() {
  const contract = { enforce: true, expectedKeys: ['userId'], params: ['payload'] }
  await assertErr(
    () => validatePayloadAgainstContract('test', [1, 2], contract),
    err => err.message.includes('got array')
  )
}

export async function testValidatePayloadMissingKeys() {
  const contract = { enforce: true, expectedKeys: ['userId', 'action'], params: ['payload'] }
  await assertErr(
    () => validatePayloadAgainstContract('test', { userId: 1 }, contract),
    err => err.message.includes('missing required keys'),
    err => err.message.includes('action'),
    err => err.status === 400
  )
}

export async function testValidatePayloadSkipsWhenNotEnforced() {
  const contract = { enforce: false, expectedKeys: ['userId'], params: ['payload'] }
  validatePayloadAgainstContract('test', 'anything', contract)
}

// ---- Integration tests: propagation + enforcement ----

export async function testContractPropagatedToRegistry() {
  const registry = await registryServer()
  await terminateAfter(
    registry,
    await createService('contract-test-svc', function handler(payload) {
      return { ok: true }
    }, { useContract: true }),
    async () => {
      const contract = registry._state.serviceContracts.get('contract-test-svc')
      assert(contract,
        c => c !== null && c !== undefined,
        c => c.enforce === true,
        c => c.params[0] === 'payload'
      )
    }
  )
}

export async function testContractAvailableInCallerCache() {
  await terminateAfter(
    await registryServer(),
    await createService('contract-provider', function handler({ userId, action }) {
      return { userId, action }
    }, { useContract: true }),
    await createService('contract-consumer', async function handler(payload) {
      return await this.call('contract-provider', payload)
    }),
    async (registry, provider, consumer) => {
      await sleep(250)
      const contract = consumer.cache.serviceContracts.get('contract-provider')
      assert(contract,
        c => c !== null && c !== undefined,
        c => c.enforce === true,
        c => c.expectedKeys.includes('userId'),
        c => c.expectedKeys.includes('action')
      )
    }
  )
}

export async function testContractEnforcesPayloadType() {
  await terminateAfter(
    await registryServer(),
    await createService('typed-svc', function handler({ userId }) {
      return { userId }
    }, { useContract: true }),
    await createService('caller-type-test', async function caller(payload) {
      return await this.call('typed-svc', payload.forward)
    }),
    async () => {
      await assertErr(
        async () => callService('caller-type-test', { forward: 'bad-string-payload' }),
        err => err.message.includes('payload must be a plain object')
      )
    }
  )
}

export async function testContractEnforcesExpectedKeys() {
  await terminateAfter(
    await registryServer(),
    await createService('keyed-svc', function handler({ userId, action }) {
      return { userId, action }
    }, { useContract: true }),
    await createService('caller-key-test', async function caller(payload) {
      return await this.call('keyed-svc', payload.forward)
    }),
    async () => {
      await assertErr(
        async () => callService('caller-key-test', { forward: { userId: 1 } }),
        err => err.message.includes('missing required keys'),
        err => err.message.includes('action')
      )
    }
  )
}

export async function testContractPassesValidPayload() {
  await terminateAfter(
    await registryServer(),
    await createService('valid-svc', function handler({ userId, action }) {
      return { userId, action, processed: true }
    }, { useContract: true }),
    await createService('caller-valid-test', async function caller(payload) {
      return await this.call('valid-svc', payload.forward)
    }),
    async () => {
      const result = await callService('caller-valid-test', { forward: { userId: 42, action: 'create' } })
      assert(result,
        r => r.userId === 42,
        r => r.action === 'create',
        r => r.processed === true
      )
    }
  )
}

export async function testNoContractNoEnforcement() {
  await terminateAfter(
    await registryServer(),
    await createService('no-contract-svc', function handler(payload) {
      return { got: typeof payload }
    }),
    await createService('caller-no-contract', async function caller(payload) {
      return await this.call('no-contract-svc', payload.forward)
    }),
    async () => {
      const result = await callService('caller-no-contract', { forward: 'any-string-is-fine' })
      assert(result, r => r.got === 'string')
    }
  )
}

export async function testContractAllowsNonObjectForNonDestructured() {
  await terminateAfter(
    await registryServer(),
    await createService('flex-svc', function handler(payload) {
      return { got: typeof payload }
    }, { useContract: true }),
    await createService('caller-flex-test', async function caller(payload) {
      return await this.call('flex-svc', payload.forward)
    }),
    async () => {
      const result = await callService('caller-flex-test', { forward: 'string-is-fine' })
      assert(result, r => r.got === 'string')
    }
  )
}

export async function testCustomContractEnforcement() {
  await terminateAfter(
    await registryServer(),
    await createService('custom-contract-svc', function handler(payload) {
      return { ok: true }
    }, { useContract: { expectedKeys: ['token', 'scope'] } }),
    await createService('caller-custom-test', async function caller(payload) {
      return await this.call('custom-contract-svc', payload.forward)
    }),
    async () => {
      await assertErr(
        async () => callService('caller-custom-test', { forward: { token: 'abc' } }),
        err => err.message.includes('missing required keys'),
        err => err.message.includes('scope')
      )

      const result = await callService('caller-custom-test', { forward: { token: 'abc', scope: 'read' } })
      assert(result, r => r.ok === true)
    }
  )
}
