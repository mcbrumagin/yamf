// TODO REMOVE THIS FILE
// // TODO/NOTE this file may be deprecated in favor of module imports

// import { dirname } from 'node:path'
// import fs from 'node:fs'

// const getFile = async path => {
//   let data = await fs.promises.readFile(path, 'utf8')
//   //console.log({data})
//   return data
// }

// async function loadClient() {
//   // TODO make more generic regex (or ideally remove the need for it)
//   // NOTE: https://regex101.com/
//   // TODO make it work for local (not installed as node_module) for testing

//   const appDir = dirname(import.meta.url.replace('file://', ''))
//   const srcDir = `${appDir}/node_modules/micro-js-html/src`

//   // Note: With the new modular approach, client loading needs to be rethought
//   // This function may need to be deprecated or significantly refactored
//   let rawElementsScript = await getFile(`${srcDir}/elements.js`)
//   let rawHtmlScript = await getFile(`${srcDir}/html.js`)

//   // WARNING: This function needs to be updated for the new modular ESM approach
//   // The old global micro pattern is no longer supported
//   return [
//     '// Client loading with modular ESM approach - needs implementation',
//     '// Consider using module bundlers or native ES modules instead',
//     await getFile(`${srcDir}/Element.js`),
//     rawElementsScript,
//     rawHtmlScript,
//     await getFile(`${srcDir}/utils.js`),
//     await getFile(`${srcDir}/client-utils.js`)
//   ].join('\n')
// }

// export default loadClient
