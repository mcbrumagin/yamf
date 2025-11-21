// TODO REMOVE THIS FILE
// // TODO probably not needed anymore
// module = {
//   set exports(fn) {
//     if (!fn.name) throw new Error('Exports must be a named function/class')
//     // console.log({exports: fn}) // Debug output removed
//     micro.modules[fn.name] = fn
//   }
// }

// require = path => {
//   let [, module] = path.match(/\/(.+)\.js$/i)
//   // console.log({module, modules: micro.modules}) // Debug output removed
//   return micro[module] || micro.modules[module]
// }
