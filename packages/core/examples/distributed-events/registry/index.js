const { registryServer } = require('@yamf/core')

console.log({env: process.env})

registryServer()
.then(() => console.log('Registry server started'))
.catch(err => console.error(err))
