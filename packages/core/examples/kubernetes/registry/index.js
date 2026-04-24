import { registryServer } from '@yamf/core'

const args = process.argv.slice(2)
const p = args[0] != null && args[0] !== '' ? Number.parseInt(String(args[0]), 10) : 10000
registryServer({ port: Number.isFinite(p) && p > 0 ? p : 10000 })
.catch(err => console.error(err))
