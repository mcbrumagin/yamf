/**
 * Validator Tests
 * 
 * Tests for the @yamf/shared validator library
 */

import { assert, assertErr } from '@yamf/test'
import { 
  is, 
  createValidator, 
  validate, 
  isSchema,
  ValidationError, 
  SchemaError 
} from '../src/validator/index.js'

// =============================================================================
// is Namespace Tests
// =============================================================================

export async function testIsStringReturnsSchemaObject() {
  const schema = is.string()
  assert(schema, 
    s => s.type === 'string',
    s => isSchema(s)
  )
}

export async function testIsStringWithConstraints() {
  const schema = is.string({ minLength: 1, maxLength: 50 })
  assert(schema,
    s => s.type === 'string',
    s => s.minLength === 1,
    s => s.maxLength === 50
  )
}

export async function testIsIntReturnsSchemaObject() {
  const schema = is.int()
  assert(schema,
    s => s.type === 'int',
    s => isSchema(s)
  )
}

export async function testIsIntWithConstraints() {
  const schema = is.int({ min: 0, max: 100 })
  assert(schema,
    s => s.type === 'int',
    s => s.min === 0,
    s => s.max === 100
  )
}

export async function testIsBoolIsSchemaObject() {
  assert(is.bool,
    s => s.type === 'bool',
    s => isSchema(s)
  )
}

export async function testIsEmailIsSchemaObject() {
  assert(is.email,
    s => s.type === 'email',
    s => isSchema(s)
  )
}

export async function testIsOneOfCreatesEnumSchema() {
  const schema = is.oneOf('a', 'b', 'c')
  assert(schema,
    s => s.type === 'oneOf',
    s => s.values.length === 3,
    s => s.values.includes('a'),
    s => s.values.includes('b'),
    s => s.values.includes('c')
  )
}

export async function testIsArrayWithItemSchema() {
  const schema = is.array(is.string())
  assert(schema,
    s => s.type === 'array',
    s => s.items?.type === 'string'
  )
}

export async function testIsOptionalCreatesModifier() {
  assert(is.optional,
    s => s.optional === true
  )
}

export async function testIsNullableCreatesModifier() {
  assert(is.nullable,
    s => s.nullable === true
  )
}

// =============================================================================
// is() Composer Tests
// =============================================================================

export async function testIsComposerMergesSchemas() {
  const schema = is(is.string(), { minLength: 5 })
  assert(schema,
    s => s.type === 'string',
    s => s.minLength === 5
  )
}

export async function testIsComposerWithOptionalModifier() {
  const schema = is(is.optional, is.string())
  assert(schema,
    s => s.type === 'string',
    s => s.optional === true
  )
}

export async function testIsComposerMultipleMerges() {
  const schema = is(is.optional, is.nullable, is.string({ maxLength: 100 }))
  assert(schema,
    s => s.type === 'string',
    s => s.optional === true,
    s => s.nullable === true,
    s => s.maxLength === 100
  )
}

// =============================================================================
// Schema Validation Tests
// =============================================================================

export async function testSchemaErrorForMinGreaterThanMax() {
  assertErr(
    () => createValidator({ age: is.int({ min: 100, max: 50 }) }),
    err => err instanceof SchemaError,
    err => err.message.includes('min (100) cannot be greater than max (50)')
  )
}

export async function testSchemaErrorForMinLengthGreaterThanMaxLength() {
  assertErr(
    () => createValidator({ name: is.string({ minLength: 10, maxLength: 5 }) }),
    err => err instanceof SchemaError,
    err => err.message.includes('minLength (10) cannot be greater than maxLength (5)')
  )
}

export async function testSchemaErrorForEmptyOneOf() {
  assertErr(
    () => createValidator({ role: is.oneOf() }),
    err => err instanceof SchemaError,
    err => err.message.includes('oneOf requires at least one value')
  )
}

export async function testSchemaErrorForNegativeMinLength() {
  assertErr(
    () => createValidator({ name: is.string({ minLength: -1 }) }),
    err => err instanceof SchemaError,
    err => err.message.includes('minLength cannot be negative')
  )
}

export async function testSchemaErrorForPositiveNegativeConflict() {
  assertErr(
    () => createValidator({ num: is.number({ positive: true, negative: true }) }),
    err => err instanceof SchemaError,
    err => err.message.includes('Cannot require both positive and negative')
  )
}

// =============================================================================
// Data Validation - String
// =============================================================================

export async function testValidatesStringType() {
  const result = validate('hello', is.string())
  assert(result,
    r => r.valid === true,
    r => r.failures.length === 0
  )
}

export async function testFailsNonStringForStringType() {
  const result = validate(123, is.string())
  assert(result,
    r => r.valid === false,
    r => r.failures.length === 1,
    r => r.failures[0].constraint === 'type'
  )
}

export async function testValidatesStringMinLength() {
  const result = validate('ab', is.string({ minLength: 3 }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'minLength'
  )
}

export async function testValidatesStringMaxLength() {
  const result = validate('hello world', is.string({ maxLength: 5 }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'maxLength'
  )
}

export async function testValidatesStringPatternFails() {
  const result = validate('hello-world', is.string({ pattern: 'alphanumeric' }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'pattern'
  )
}

export async function testValidatesStringPatternPasses() {
  const result = validate('hello123', is.string({ pattern: 'alphanumeric' }))
  assert(result,
    r => r.valid === true
  )
}

// =============================================================================
// Data Validation - Numbers
// =============================================================================

export async function testValidatesIntType() {
  const result = validate(42, is.int())
  assert(result,
    r => r.valid === true
  )
}

export async function testFailsFloatForIntType() {
  const result = validate(3.14, is.int())
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'type'
  )
}

export async function testValidatesIntMin() {
  const result = validate(-5, is.int({ min: 0 }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'min'
  )
}

export async function testValidatesIntMax() {
  const result = validate(200, is.int({ max: 100 }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'max'
  )
}

export async function testValidatesNumberPositive() {
  const result = validate(-1, is.number({ positive: true }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'positive'
  )
}

// =============================================================================
// Data Validation - Email
// =============================================================================

export async function testValidatesValidEmail() {
  const result = validate('test@example.com', is.email)
  assert(result,
    r => r.valid === true
  )
}

export async function testFailsInvalidEmail() {
  const result = validate('not-an-email', is.email)
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'email'
  )
}

// =============================================================================
// Data Validation - Arrays
// =============================================================================

export async function testValidatesArrayType() {
  const result = validate([1, 2, 3], is.array())
  assert(result,
    r => r.valid === true
  )
}

export async function testFailsNonArrayForArrayType() {
  const result = validate('not array', is.array())
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'type'
  )
}

export async function testValidatesArrayItemTypes() {
  const result = validate(['a', 'b', 123], is.array(is.string()))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].path.includes('[2]')
  )
}

export async function testValidatesArrayMinLength() {
  const result = validate([1], is.array({ minLength: 2 }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'minLength'
  )
}

// =============================================================================
// Data Validation - oneOf
// =============================================================================

export async function testValidatesOneOfMatch() {
  const result = validate('admin', is.oneOf('admin', 'user', 'guest'))
  assert(result,
    r => r.valid === true
  )
}

export async function testFailsOneOfNoMatch() {
  const result = validate('superuser', is.oneOf('admin', 'user', 'guest'))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'oneOf'
  )
}

// =============================================================================
// Data Validation - Nested Objects
// =============================================================================

export async function testValidatesNestedObject() {
  const schema = {
    user: {
      name: is.string(),
      age: is.int()
    }
  }
  const result = validate({ user: { name: 'John', age: 30 } }, schema)
  assert(result,
    r => r.valid === true
  )
}

export async function testFailsNestedObjectWithInvalidField() {
  const schema = {
    user: {
      name: is.string(),
      age: is.int()
    }
  }
  const result = validate({ user: { name: 'John', age: 'thirty' } }, schema)
  assert(result,
    r => r.valid === false,
    r => r.failures[0].path === 'user.age'
  )
}

// =============================================================================
// Data Validation - Optional/Nullable
// =============================================================================

export async function testOptionalAllowsUndefined() {
  const schema = is(is.optional, is.string())
  const result = validate(undefined, schema)
  assert(result,
    r => r.valid === true
  )
}

export async function testOptionalFailsOnNull() {
  const schema = is(is.optional, is.string())
  const result = validate(null, schema)
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'nullable'
  )
}

export async function testNullableAllowsNull() {
  const schema = is(is.nullable, is.string())
  const result = validate(null, schema)
  assert(result,
    r => r.valid === true
  )
}

export async function testNilableAllowsNullAndUndefined() {
  const schema = is(is.nilable, is.string())
  const resultNull = validate(null, schema)
  const resultUndefined = validate(undefined, schema)
  assert(resultNull, r => r.valid === true)
  assert(resultUndefined, r => r.valid === true)
}

// =============================================================================
// Data Validation - Transformers
// =============================================================================

export async function testTransformTrim() {
  const schema = is.string({ transform: ['trim'] })
  const result = validate('  hello  ', schema)
  assert(result,
    r => r.valid === true,
    r => r.data === 'hello'
  )
}

export async function testTransformLowercase() {
  const schema = is.string({ transform: ['lowercase'] })
  const result = validate('HELLO', schema)
  assert(result,
    r => r.valid === true,
    r => r.data === 'hello'
  )
}

export async function testTransformToInt() {
  const schema = is.int({ transform: ['toInt'] })
  const result = validate('42', schema)
  assert(result,
    r => r.valid === true,
    r => r.data === 42
  )
}

export async function testTransformChainMultiple() {
  const schema = is.string({ transform: ['trim', 'lowercase'] })
  const result = validate('  HELLO  ', schema)
  assert(result,
    r => r.valid === true,
    r => r.data === 'hello'
  )
}

// =============================================================================
// createValidator Tests
// =============================================================================

export async function testCreateValidatorReturnsFunction() {
  const validator = createValidator({ name: is.string() })
  assert(() => validator, // enclose in function to avoid immediate evaluation
    v => typeof v === 'function',
    v => typeof v.validate === 'function',
    v => typeof v.isValid === 'function'
  )
}

export async function testCreateValidatorThrowsValidationErrorOnFailure() {
  const validator = createValidator({ age: is.int({ min: 0 }) })
  assertErr(
    () => validator({ age: -5 }),
    err => err instanceof ValidationError,
    err => err.failures.length === 1
  )
}

export async function testCreateValidatorReturnsDataOnSuccess() {
  const validator = createValidator({ name: is.string() })
  const result = validator({ name: 'John' })
  assert(result,
    r => r.name === 'John'
  )
}

export async function testCreateValidatorIsValidReturnsBoolean() {
  const validator = createValidator({ name: is.string() })
  assert(validator.isValid({ name: 'John' }), v => v === true)
  assert(validator.isValid({ name: 123 }), v => v === false)
}

// =============================================================================
// Custom Validation
// =============================================================================

export async function testIsCustomWithPassingFunction() {
  const schema = is.custom((val) => val > 10, 'Must be greater than 10')
  const result = validate(15, schema)
  assert(result,
    r => r.valid === true
  )
}

export async function testIsCustomWithFailingFunction() {
  const schema = is.custom((val) => val > 10, 'Must be greater than 10')
  const result = validate(5, schema)
  assert(result,
    r => r.valid === false,
    r => r.failures[0].message === 'Must be greater than 10'
  )
}

export async function testIsRefineAddsValidationToSchema() {
  const schema = is.refine(
    is.string({ minLength: 1 }),
    (val) => val.startsWith('hello'),
    'Must start with hello'
  )
  
  const result1 = validate('hello world', schema)
  assert(result1, r => r.valid === true)
  
  const result2 = validate('goodbye', schema)
  assert(result2,
    r => r.valid === false,
    r => r.failures[0].constraint === 'refine'
  )
}

// =============================================================================
// Password Validation
// =============================================================================

export async function testPasswordValidatesLength() {
  const result = validate('short', is.password())
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'minLength'
  )
}

export async function testPasswordValidatesUppercaseRequirement() {
  const result = validate('longpassword1', is.password({ requireUppercase: true }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'uppercase'
  )
}

export async function testPasswordValidatesNumberRequirement() {
  const result = validate('LongPassword', is.password({ requireNumber: true }))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'number'
  )
}

export async function testPasswordPassesAllRequirements() {
  const result = validate('SecurePass1', is.password())
  assert(result,
    r => r.valid === true
  )
}

// =============================================================================
// Complex Schema Tests
// =============================================================================

export async function testValidatesComplexNestedSchema() {
  const userSchema = {
    userName: is.alphanumeric({ minLength: 3, maxLength: 20 }),
    email: is.email,
    age: is.int({ min: 0, max: 150 }),
    preferences: {
      theme: is.oneOf('dark', 'light'),
      notifications: is.array(is.oneOf('events', 'news', 'updates'))
    },
    role: is.oneOf('admin', 'user'),
    bio: is(is.optional, is.string({ maxLength: 500 }))
  }
  
  const validator = createValidator(userSchema, { name: 'User' })
  
  const validData = {
    userName: 'john123',
    email: 'john@example.com',
    age: 30,
    preferences: {
      theme: 'dark',
      notifications: ['events', 'news']
    },
    role: 'user'
  }
  
  const result = validator.validate(validData)
  assert(result,
    r => r.valid === true,
    r => r.failures.length === 0
  )
}

export async function testCollectsMultipleFailures() {
  const schema = {
    name: is.string({ minLength: 1 }),
    age: is.int({ min: 0 }),
    email: is.email
  }
  
  const result = validate({
    name: '',
    age: -5,
    email: 'invalid'
  }, schema)
  
  assert(result,
    r => r.valid === false,
    r => r.failures.length === 3,
    r => r.failures.some(f => f.path === 'name'),
    r => r.failures.some(f => f.path === 'age'),
    r => r.failures.some(f => f.path === 'email')
  )
}


export async function testCollectsMultipleNestedFailures() {
  const schema = {
    name: is.string({ minLength: 1 }),
    age: is.int({ min: 0 }),
    email: is.email,
    address: {
      street: is.string({ minLength: 1 }),
      city: is.string({ minLength: 1 }),
      state: is.string({ minLength: 1 }),
      zip: is.string({ minLength: 1 })
    }
  }
  
  const result = validate({
    name: '',
    age: -5,
    email: 'invalid',
    address: {
      street: '',
      city: '',
      state: '',
      zip: ''
    }
  }, schema)
  
  assert(result,
    r => r.valid === false,
    r => r.failures.length === 7,
    r => r.failures.some(f => f.path === 'name'),
    r => r.failures.some(f => f.path === 'age'),
    r => r.failures.some(f => f.path === 'email'),
    r => r.failures.some(f => f.path === 'address.street'),
    r => r.failures.some(f => f.path === 'address.city'),
    r => r.failures.some(f => f.path === 'address.state'),
    r => r.failures.some(f => f.path === 'address.zip')
  )
}

// =============================================================================
// Date/DateTime Validation
// =============================================================================

export async function testValidatesDateFormat() {
  const result = validate('2024-01-15', is.date())
  assert(result, r => r.valid === true)
}

export async function testFailsInvalidDateFormat() {
  const result = validate('01-15-2024', is.date())
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'date'
  )
}

export async function testValidatesDateTimeFormat() {
  const result = validate('2024-01-15T10:30:00Z', is.datetime())
  assert(result, r => r.valid === true)
}

// =============================================================================
// URL Validation
// =============================================================================

export async function testValidatesValidUrl() {
  const result = validate('https://example.com/path', is.url)
  assert(result, r => r.valid === true)
}

export async function testFailsInvalidUrl() {
  const result = validate('not a url', is.url)
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'url'
  )
}

// =============================================================================
// Literal Validation
// =============================================================================

export async function testValidatesLiteralMatch() {
  const result = validate('exact', is.literal('exact'))
  assert(result, r => r.valid === true)
}

export async function testFailsLiteralMismatch() {
  const result = validate('different', is.literal('exact'))
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'literal'
  )
}

// =============================================================================
// anyOf Validation
// =============================================================================

export async function testValidatesAnyOfFirstMatch() {
  const schema = is.anyOf(is.string(), is.int())
  const result = validate('hello', schema)
  assert(result, r => r.valid === true)
}

export async function testValidatesAnyOfSecondMatch() {
  const schema = is.anyOf(is.string(), is.int())
  const result = validate(42, schema)
  assert(result, r => r.valid === true)
}

export async function testFailsAnyOfNoMatch() {
  const schema = is.anyOf(is.string(), is.int())
  const result = validate(true, schema)
  assert(result,
    r => r.valid === false,
    r => r.failures[0].constraint === 'anyOf'
  )
}
