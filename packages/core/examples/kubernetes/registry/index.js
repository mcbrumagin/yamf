import { registryServer } from '@yamf/core'

const args = process.argv.slice(2)
registryServer(args[0] || 10000)
.catch(err => console.error(err))
