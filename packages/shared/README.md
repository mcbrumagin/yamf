# @yamf/shared

Shared utilities for YAMF - truly isomorphic code that works in both browser and Node.js.

[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## Status

⚠️ **Under Development** - This module is currently being built out with shared utilities that will be used across the YAMF ecosystem.

## Planned Features

### Validators

Validation utilities shared between `@yamf/core` (for runtime validation) and `@yamf/test` (for test assertions).

```javascript
import { validators } from '@yamf/shared'

// Type validators
validators.isString(value)
validators.isNumber(value)
validators.isObject(value)
validators.isArray(value)
validators.isFunction(value)

// Schema validation
validators.validateSchema(data, schema)
```

### Utilities

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
- **Type Safe**: Full TypeScript definitions (coming soon)

## Installation

```sh
npm install @yamf/shared
```

## Usage

```javascript
// Full import
import { validators, utils } from '@yamf/shared'

// Selective imports
import { validators } from '@yamf/shared/validators'
import { utils } from '@yamf/shared/utils'
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
