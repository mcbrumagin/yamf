/**
 * Generic CLI argument parser.
 *
 * @param {string[]} args - raw args array (typically process.argv.slice(3) or similar)
 * @param {Object} spec - flag/option definitions
 *
 * Spec format:
 *   {
 *     help:    { flags: ['-h', '--help'] },                           // boolean
 *     verbose: { flags: ['-v', '--verbose'] },                        // boolean
 *     payload: { flags: ['-p', '--payload'], type: 'string' },        // string value
 *     lines:   { flags: ['-n', '--lines'], type: 'number', default: 50 }, // number with default
 *   }
 *
 * - Boolean entries default to false unless overridden with `default: true`.
 * - String/number entries default to null unless overridden with `default`.
 * - If a value-taking flag is the last arg (nothing after it), an error is thrown.
 *
 * Returns { parsed, positional }:
 *   parsed     - object with flag values
 *   positional - array of args that didn't match any flag
 */
export default function parseArgs(args, spec) {
  const parsed = {}
  const positional = []

  const flagMap = {}
  for (const [name, config] of Object.entries(spec)) {
    const isBoolean = !config.type
    parsed[name] = config.default ?? (isBoolean ? false : null)
    for (const flag of config.flags) {
      flagMap[flag] = { name, type: config.type }
    }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const entry = flagMap[arg]

    if (!entry) {
      if (arg.startsWith('-')) {
        throw new Error(`Unknown flag: ${arg}`)
      }
      positional.push(arg)
      continue
    }

    if (!entry.type) {
      parsed[entry.name] = true
      continue
    }

    i++
    if (i >= args.length) {
      throw new Error(`Flag ${arg} requires a value`)
    }

    const raw = args[i]
    if (entry.type === 'number') {
      const num = Number(raw)
      if (isNaN(num)) throw new Error(`Flag ${args[i - 1]} expects a number, got "${raw}"`)
      parsed[entry.name] = num
    } else {
      parsed[entry.name] = raw
    }
  }

  return { ...parsed, _positional: positional }
}
