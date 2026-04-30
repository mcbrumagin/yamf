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
  validatePayloadAgainstContract,
  serializeSchema,
  deserializeSchema
} from '../../src/service/service-contract.js'

import { is, createValidator } from '@yamf/shared/validator'

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
  await validatePayloadAgainstContract('test', { userId: 1 }, contract)
}

export async function testValidatePayloadAllowsStringWhenNoExpectedKeys() {
  const contract = { enforce: true, expectedKeys: [], params: ['payload'] }
  await validatePayloadAgainstContract('test', 'string-payload-is-fine', contract)
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
  await validatePayloadAgainstContract('test', 'anything', contract)
}

// ---- Integration tests: propagation + enforcement ----

export async function testContractPropagatedToRegistry() {
  const registry = await registryServer()
  await terminateAfter(
    () => registry,
    () => createService('contract-test-svc', function handler(payload) {
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
    () => registryServer(),
    () => createService('contract-provider', function handler({ userId, action }) {
      return { userId, action }
    }, { useContract: true }),
    () => createService('contract-consumer', async function handler(payload) {
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
    () => registryServer(),
    () => createService('typed-svc', function handler({ userId }) {
      return { userId }
    }, { useContract: true }),
    () => createService('caller-type-test', async function caller(payload) {
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
    () => registryServer(),
    () => createService('keyed-svc', function handler({ userId, action }) {
      return { userId, action }
    }, { useContract: true }),
    () => createService('caller-key-test', async function caller(payload) {
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
    () => registryServer(),
    () => createService('valid-svc', function handler({ userId, action }) {
      return { userId, action, processed: true }
    }, { useContract: true }),
    () => createService('caller-valid-test', async function caller(payload) {
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
    () => registryServer(),
    () => createService('no-contract-svc', function handler(payload) {
      return { got: typeof payload }
    }),
    () => createService('caller-no-contract', async function caller(payload) {
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
    () => registryServer(),
    () => createService('flex-svc', function handler(payload) {
      return { got: typeof payload }
    }, { useContract: true }),
    () => createService('caller-flex-test', async function caller(payload) {
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
    () => registryServer(),
    () => createService('custom-contract-svc', function handler(payload) {
      return { ok: true }
    }, { useContract: { expectedKeys: ['token', 'scope'] } }),
    () => createService('caller-custom-test', async function caller(payload) {
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

// =============================================================================
// Validator contract tests
// =============================================================================

// ---- Unit: schema serialization ----

export async function testSerializeSchemaBasic() {
  const schema = {
    name: is.string({ minLength: 1, maxLength: 100 }),
    age: is.int({ min: 0 }),
  }
  const serialized = serializeSchema(schema)
  assert(serialized,
    s => s.name._yamfSchema === true,
    s => s.name.type === 'string',
    s => s.name.minLength === 1,
    s => s.name.maxLength === 100,
    s => s.age._yamfSchema === true,
    s => s.age.type === 'int',
    s => s.age.min === 0
  )
}

export async function testSerializeSchemaWithRegex() {
  const schema = { slug: is.regex(/^[a-z]+$/, { maxLength: 50 }) }
  const serialized = serializeSchema(schema)
  assert(serialized,
    s => s.slug.type === 'string',
    s => s.slug.pattern._regex === true,
    s => s.slug.pattern.source === '^[a-z]+$'
  )
}

export async function testSerializeSchemaWithNamedPattern() {
  const schema = { id: is.uuid }
  const serialized = serializeSchema(schema)
  assert(serialized,
    s => s.id.pattern === 'uuid'
  )
}

export async function testSerializeSchemaDropsCustomFunctions() {
  const schema = {
    name: is.string(),
    custom: is.custom(() => true, 'always passes'),
  }
  const serialized = serializeSchema(schema)
  assert(serialized,
    s => s.name._yamfSchema === true,
    s => s.custom._yamfSchema === true,
    s => s.custom.validate === undefined
  )
}

export async function testSerializeSchemaNestedObject() {
  const schema = {
    user: {
      name: is.string(),
      email: is.email,
    }
  }
  const serialized = serializeSchema(schema)
  assert(serialized,
    s => s.user.name._yamfSchema === true,
    s => s.user.name.type === 'string',
    s => s.user.email._yamfSchema === true,
    s => s.user.email.type === 'email'
  )
}

export async function testSerializeSchemaWithOptional() {
  const schema = {
    name: is.string(),
    bio: is(is.optional, is.string()),
  }
  const serialized = serializeSchema(schema)
  assert(serialized,
    s => s.bio._yamfSchema === true,
    s => s.bio.optional === true,
    s => s.bio.type === 'string'
  )
}

export async function testSerializeSchemaWithOneOf() {
  const schema = {
    role: is.oneOf('admin', 'user', 'guest'),
  }
  const serialized = serializeSchema(schema)
  assert(serialized,
    s => s.role._yamfSchema === true,
    s => s.role.type === 'oneOf',
    s => s.role.values.length === 3,
    s => s.role.values[0] === 'admin'
  )
}

// ---- Unit: schema deserialization ----

export async function testDeserializeSchemaRoundTrip() {
  const schema = {
    name: is.string({ minLength: 1, maxLength: 100 }),
    age: is.int({ min: 0, max: 150 }),
    role: is.oneOf('admin', 'user'),
  }
  const serialized = serializeSchema(schema)
  const jsonStr = JSON.stringify(serialized)
  const deserialized = deserializeSchema(JSON.parse(jsonStr))

  // The SCHEMA_SYMBOL should be restored
  const SCHEMA_SYM = Symbol.for('yamf.validator.schema')
  assert(deserialized,
    d => d.name[SCHEMA_SYM] === true,
    d => d.name.type === 'string',
    d => d.name.minLength === 1,
    d => d.age[SCHEMA_SYM] === true,
    d => d.age.type === 'int',
    d => d.role[SCHEMA_SYM] === true,
    d => d.role.type === 'oneOf',
    d => d.role.values.includes('admin')
  )
}

export async function testDeserializeSchemaRegexRoundTrip() {
  const schema = { slug: is.regex(/^[a-z-]+$/) }
  const serialized = serializeSchema(schema)
  const deserialized = deserializeSchema(JSON.parse(JSON.stringify(serialized)))

  assert(deserialized,
    d => d.slug.pattern instanceof RegExp,
    d => d.slug.pattern.source === '^[a-z-]+$'
  )
}

// ---- Unit: buildContract with validator ----

export async function testBuildContractFromValidatorFunction() {
  const validateUser = createValidator({
    name: is.string({ minLength: 1 }),
    email: is.email,
    age: is(is.optional, is.int({ min: 0 })),
  }, { name: 'TestUser' })

  const contract = buildContract(validateUser, function handler(payload) {})
  assert(contract,
    c => c !== null,
    c => c.enforce === true,
    c => c.contractType === 'validator',
    c => c.schemaName === 'TestUser',
    c => c.validatorSchema !== null,
    c => c.validatorSchema.name._yamfSchema === true,
    c => c.validatorSchema.email._yamfSchema === true,
    c => c.expectedKeys.includes('name'),
    c => c.expectedKeys.includes('email'),
    c => !c.expectedKeys.includes('age')  // age is optional, not in expectedKeys
  )
}

export async function testBuildContractFromRawSchema() {
  const schema = {
    token: is.string({ minLength: 1 }),
    scope: is.oneOf('read', 'write'),
  }

  const contract = buildContract(schema, function handler(payload) {})
  assert(contract,
    c => c.contractType === 'validator',
    c => c.enforce === true,
    c => c.validatorSchema.token._yamfSchema === true,
    c => c.validatorSchema.scope.type === 'oneOf',
    c => c.expectedKeys.includes('token'),
    c => c.expectedKeys.includes('scope')
  )
}

export async function testBuildContractTrueIsNotValidator() {
  const contract = buildContract(true, function handler(payload) {})
  assert(contract,
    c => c.contractType === 'signature',
    c => c.validatorSchema === undefined
  )
}

// ---- Unit: validator contract validation ----

export async function testValidatePayloadWithValidatorContract() {
  const validateUser = createValidator({
    name: is.string({ minLength: 1 }),
    age: is.int({ min: 0 }),
  })

  const contract = buildContract(validateUser, function handler(p) {})

  await validatePayloadAgainstContract('test', { name: 'Alice', age: 30 }, contract)
}

export async function testValidatePayloadWithValidatorContractRejectsBadType() {
  const validateUser = createValidator({
    name: is.string({ minLength: 1 }),
    age: is.int({ min: 0 }),
  })

  const contract = buildContract(validateUser, function handler(p) {})

  await assertErr(
    async () => validatePayloadAgainstContract('test', { name: 'Alice', age: 'not-a-number' }, contract),
    err => err.message.includes('Contract violation'),
    err => err.message.includes('age'),
    err => err.status === 400
  )
}

export async function testValidatePayloadWithValidatorContractRejectsMissing() {
  const validateUser = createValidator({
    name: is.string({ minLength: 1 }),
    age: is.int({ min: 0 }),
  })

  const contract = buildContract(validateUser, function handler(p) {})

  await assertErr(
    async () => validatePayloadAgainstContract('test', { name: 'Alice' }, contract),
    err => err.message.includes('Contract violation'),
    err => err.message.includes('age'),
    err => err.status === 400
  )
}

export async function testValidatePayloadWithValidatorContractRejectsConstraint() {
  const schema = {
    name: is.string({ minLength: 3, maxLength: 50 }),
  }

  const contract = buildContract(createValidator(schema), function handler(p) {})

  await assertErr(
    async () => validatePayloadAgainstContract('test', { name: 'AB' }, contract),
    err => err.message.includes('at least 3 characters'),
    err => err.status === 400
  )
}

// ---- Integration: validator contract over the wire ----

export async function testValidatorContractPropagatedToRegistry() {
  const validateAction = createValidator({
    userId: is.int({ positive: true }),
    action: is.oneOf('create', 'update', 'delete'),
  }, { name: 'TestAction' })

  const registry = await registryServer()
  await terminateAfter(
    () => registry,
    () => createService('validator-svc', function handler(payload) {
      return { ok: true }
    }, { useContract: validateAction }),
    async () => {
      const contract = registry._state.serviceContracts.get('validator-svc')
      assert(contract,
        c => c !== null && c !== undefined,
        c => c.contractType === 'validator',
        c => c.enforce === true,
        c => c.schemaName === 'TestAction',
        c => c.validatorSchema !== null
      )
    }
  )
}

export async function testValidatorContractEnforcesSchema() {
  const validatePayload = createValidator({
    userId: is.int({ positive: true }),
    action: is.oneOf('create', 'update', 'delete'),
  })

  await terminateAfter(
    () => registryServer(),
    () => createService('validated-svc', function handler(payload) {
      return { received: payload }
    }, { useContract: validatePayload }),
    () => createService('caller-validated', async function caller(payload) {
      return await this.call('validated-svc', payload.forward)
    }),
    async () => {
      // Valid payload should pass
      const result = await callService('caller-validated', { forward: { userId: 1, action: 'create' } })
      assert(result,
        r => r.received.userId === 1,
        r => r.received.action === 'create'
      )

      // Invalid payload should fail (bad action value)
      await assertErr(
        async () => callService('caller-validated', { forward: { userId: 1, action: 'invalid' } }),
        err => err.message.includes('Contract violation')
      )

      // Invalid payload should fail (wrong type for userId)
      await assertErr(
        async () => callService('caller-validated', { forward: { userId: 'not-a-number', action: 'create' } }),
        err => err.message.includes('Contract violation')
      )
    }
  )
}

export async function testValidatorContractFromNamedServiceContextCall() {
  const validatePayload = createValidator({
    userId: is.int({ positive: true }),
    action: is.oneOf('create', 'update', 'delete'),
  })

  await terminateAfter(
    () => registryServer(),
    () => createService('namedService', function (payload) {
      return { received: payload }
    }, { useContract: validatePayload }),
    () => createService('caller-validated', async function (payload) {
      return await this.namedService(payload.forward)
    }),
    async () => {
      // Valid payload should pass
      const result = await callService('caller-validated', { forward: { userId: 1, action: 'create' } })
      assert(result,
        r => r.received.userId === 1,
        r => r.received.action === 'create'
      )

      // Invalid payload should fail (bad action value)
      await assertErr(
        async () => callService('caller-validated', { forward: { userId: 1, action: 'invalid' } }),
        err => err.message.includes('Contract violation')
      )

      // Invalid payload should fail (wrong type for userId)
      await assertErr(
        async () => callService('caller-validated', { forward: { userId: 'not-a-number', action: 'create' } }),
        err => err.message.includes('Contract violation')
      )
    }
  )
}