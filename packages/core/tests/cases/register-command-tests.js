/**
 * Registry registerCommand (slice F)
 */
import { assert, assertErr } from '@yamf/test'
import { createRegistryState } from '../../src/registry/registry-state.js'
import { registerCommand, unregisterCommand } from '../../src/registry/command-router.js'
import { COMMANDS } from '../../src/shared/yamf-headers.js'

export async function testRegisterCommandRejectsReservedName() {
  const state = createRegistryState()
  await assertErr(
    () => {
      registerCommand(state, COMMANDS.HEALTH, async () => ({}), { service: 'a', location: 'http://x' })
    },
    (e) => e.message && e.message.includes('reserved')
  )
}

export async function testRegisterCommandRegistersAndUnregisters() {
  const state = createRegistryState()
  const handler = async () => ({ ok: 1 })
  registerCommand(state, 'MY_PLUGIN_CMD', handler, { service: 'p', location: 'http://localhost:1' })
  await assert(state, s => s.pluginCommands.get('MY_PLUGIN_CMD')?.handler === handler)
  unregisterCommand(state, 'MY_PLUGIN_CMD')
  await assert(state, s => !s.pluginCommands.has('MY_PLUGIN_CMD'))
}
