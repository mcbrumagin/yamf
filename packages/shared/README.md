# @yamf/shared

Shared utilities for YAMF - truly isomorphic code that works in both browser and Node.js.

[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## Validator

A declarative, composable validation library that works on both client and server.

### Quick Start

```javascript
import { is, createValidator } from '@yamf/shared/validator'

// Define a schema using the `is` namespace
const userSchema = {
  userName: is.alphanumeric({ minLength: 3, maxLength: 20 }),
  email: is.email,
  age: is.int({ min: 0, max: 150 }),
  role: is.oneOf('admin', 'user', 'guest'),
  preferences: {
    theme: is.oneOf('dark', 'light'),
    notifications: is.array(is.oneOf('events', 'news', 'updates'))
  },
  bio: is(is.optional, is.string({ maxLength: 500 }))
}

// Create a reusable validator
const validateUser = createValidator(userSchema, { name: 'User' })

// Validate data (throws ValidationError with all failures)
const user = validateUser(userData)

// Or check without throwing
const { valid, failures, data } = validateUser.validate(userData)
const isValid = validateUser.isValid(userData)
```

### The `is` API

`is` serves dual purposes:
1. **As a namespace** for type builders: `is.string()`, `is.int`, `is.email`
2. **As a composer** for merging schemas: `is(is.optional, is.string())`

#### Type Builders

```javascript
// Strings - constraints: minLength, maxLength, pattern, transform
is.string({ minLength: 1, maxLength: 100 })
is.alphanumeric({ maxLength: 20 })
is.slug()
is.uuid
is.email
is.url
is.password({ minLength: 8, requireUppercase: true, requireNumber: true })

// Numbers - constraints: min, max, positive, negative
is.int({ min: 0, max: 100 })
is.number({ positive: true })

// Boolean
is.bool

// Dates - constraints: min, max (can use 'now')
is.date({ max: 'now' })
is.datetime({ min: '2020-01-01' })

// Arrays - constraints: minLength, maxLength, unique
is.array(is.string())
is.array(is.oneOf('a', 'b', 'c'), { minLength: 1 })

// Objects (explicit)
is.object({ name: is.string() }, { strict: true })

// Enums and Unions
is.oneOf('admin', 'user', 'guest')
is.anyOf(is.string(), is.int())
is.literal('exact-value')

// Special
is.any  // Accepts anything (escape hatch)
```

#### Modifiers

```javascript
// Optional - value can be undefined/missing
is(is.optional, is.string())

// Nullable - value can be null
is(is.nullable, is.string())

// Nilable - value can be null OR undefined
is(is.nilable, is.string())
```

#### Composition with `is()`

```javascript
// Merge schemas left-to-right
const optionalEmail = is(is.optional, is.email)

// Add constraints to types
const positiveAge = is(is.int, { min: 0, max: 150 })

// Multiple modifiers
const optionalNullableString = is(is.optional, is.nullable, is.string())
```

#### Custom Validation

```javascript
// Custom validator function
const isPastDate = is.custom(
  (date) => new Date(date) < new Date(),
  'Must be a date in the past'
)

// Refine an existing schema with additional validation
const validUsername = is.refine(
  is.string({ minLength: 3 }),
  (val) => !val.includes('admin'),
  'Username cannot contain "admin"'
)
```

#### Transformers

Transform data before validation:

```javascript
const schema = {
  email: is.string({ transform: ['trim', 'lowercase'] }),
  age: is.int({ transform: ['toInt'] }),  // Convert string to int
}

// Built-in transformers:
// trim, lowercase, uppercase, toInt, toFloat, toNumber, toString, toBoolean, toArray, toDate

// Custom transformer
const trimmedString = is.string({
  transform: [(val) => val.trim().replace(/\s+/g, ' ')]
})
```

### Schema Validation (Catch Errors Early)

Illogical schemas throw `SchemaError` at creation time:

```javascript
// These all throw SchemaError:
createValidator({ age: is.int({ min: 100, max: 50 }) })     // min > max
createValidator({ name: is.string({ minLength: -1 }) })     // negative minLength
createValidator({ role: is.oneOf() })                        // empty oneOf
createValidator({ n: is.number({ positive: true, negative: true }) })  // conflict
```

### Error Handling

```javascript
import { ValidationError, SchemaError } from '@yamf/shared/validator'

try {
  validateUser(badData)
} catch (err) {
  if (err instanceof ValidationError) {
    console.log(err.failures) // Array of ValidationFailure objects
    // Each failure has: path, value, constraint, message
  }
}
```

### Integration with Assertions

```javascript
import { assert } from '@yamf/test'

// Use validator directly in assertions
assert(responseData, validateUser)

// Or use the isValid helper
assert(validateUser.isValid(responseData), true)
```

## Utilities (Planned)

Common utility functions used across YAMF packages.

```javascript
import { utils } from '@yamf/shared'

// Deep object utilities
utils.deepMerge(target, source)
utils.deepClone(object)
utils.deepEqual(a, b)

// String utilities
utils.camelToKebab(str)
utils.kebabToCamel(str)
```

## Design Goals

- **Truly Isomorphic**: Works identically in Node.js and browsers
- **Zero Dependencies**: No external dependencies
- **Tree-Shakeable**: Import only what you need
- **Declarative**: Schemas are plain objects (serializable, introspectable)
- **Type Safe**: Full TypeScript definitions (coming soon)

## Installation

```sh
npm install @yamf/shared
```

## Usage

```javascript
// Full import
import { is, createValidator, validate } from '@yamf/shared'

// Selective imports
import { is, createValidator } from '@yamf/shared/validator'
```

## Relationship to Other Packages

| Package | Uses @yamf/shared for |
|---------|----------------------|
| `@yamf/core` | Request/response validation, schema validation |
| `@yamf/test` | Test assertion utilities, validation helpers |
| `@yamf/client` | Form validation, data utilities |

## Contributing

This module is actively being developed. Contributions and suggestions are welcome!

## License

MIT
