/**
 * Case mapper helpers: camelCase / snakeCase for plain objects.
 */
import { toCamelCase, toSnakeCase } from '@yamf/shared'

const camel = toCamelCase({ user_name: 'x' })
const snake = toSnakeCase({ userName: 'y' })
if (camel.userName !== 'x' || snake.user_name !== 'y') {
  console.error('unexpected mapper output', { camel, snake })
  process.exit(1)
}
console.log('case-mapper ok:', camel, snake)
