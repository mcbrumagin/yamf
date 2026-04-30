/**
 * Case mapper helpers: camelCase / snakeCase for plain objects.
 */
import { toCamelCase, toSnakeCase } from '@yamf/shared'

const camel = toCamelCase({ user_name: 'x' })
const snake = toSnakeCase({ userName: 'y' })
console.log('toCamelCase sample:', camel)
console.log('toSnakeCase sample:', snake)
