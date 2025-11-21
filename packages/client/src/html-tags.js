import elements from './elements.js'

const htmlTags = {}
for (let elem in elements) {
  const Element = elements[elem]
  const shortFn = (...args) => new Element(...args)
  const tag = new Element().tag
  htmlTags[tag] = shortFn
}

export default htmlTags
