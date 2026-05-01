/**
 * `schema-validation.js` — invalid schema shapes at author time.
 */
import { assertErr } from '@yamf/test'
import { SchemaError } from '../src/validator/errors.js'
import { validateSchema } from '../src/validator/schema-validation.js'

export function testValidateSchemaRejectsNonObject () {
  assertErr(
    () => validateSchema(null),
    (e) => e instanceof SchemaError && /must be an object/i.test(e.message)
  )
}
