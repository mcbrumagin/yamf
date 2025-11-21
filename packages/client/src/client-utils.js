
// client-util.js TODO rename to globals? or scope to "micro.utils"

// import { htmlTags } from './index.js' // TODO
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

window.micro.library = async function waitForElement(tag, interval = 10) {
  let element
  do {
    element = document.querySelector(tag)
    await sleep(interval)
  } while (!element)
  return element
}

window.micro.library = function isMobileBrowser() {
  // from http://detectmobilebrowsers.com/
  let agent = navigator.userAgent||navigator.vendor||window.opera
  if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(agent)
  || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(agent.substr(0,4))) {
    return true
  } else return false
}

window.micro.library = async function loadResource(path) {
  return new Promise(async resolve => {
    const { waitForElement, htmlTags: { link } } = micro
    let type = path.includes('css') ? 'text/css' : 'js'  // TODO other stuff
    let rel = path.includes('css') ? 'stylesheet' : 'js' // TODO other stuff
    let newLink = link({ type, rel, href: path, onload: resolve })
    let newLinkNode = newLink.toDomNode()
    let head = await waitForElement('head')
    head.appendChild(newLinkNode)
  })
}

// TODO make this work on server-side
window.micro.library = function router(routeMap, options) {
  if (typeof options !== 'object') {
    options = options
      ? { renderLocation: options }
      : { renderLocation: 'body' }
  }

  document.addEventListener('click', async event => {
    // Debug: CLICK event on element (consider using logger if needed)
    if (event.target.localName === 'a'
    && event.target.getAttribute('href') != null
    && event.target.getAttribute('target') !== '_blank') {
      event.preventDefault()
      await routeChangeHandler(event)
    }
  })

  const resolvePath = (path = '', routeMap) => {
    for (let route in routeMap) {
      if (route.replace(/\//ig, '') === path) {
        return routeMap[route]
      }
    }
    // Warning: failed route match - could use logger.warn here
  }

  const routeChangeHandler = async event => {
    let oldUrl = window.location.href
    let url = oldUrl

    if (options.before) await options.before(event)
    if (event) {
      let newPath = event.target.getAttribute('href')
      url = newPath
    } else {
      url = url.replace(/^.+\:\/\/[^\/]+/i, '')
      if (!url) url = '/' // default to root
    }

    if (!url) return // added for link download
    
    let pathFragments = url.replace(/^\//ig,'').split('/')

    let pathIndex = 0
    let result
    do {
      let path = pathFragments[pathIndex]
      result = resolvePath(path, result || routeMap)
      pathIndex++
    } while (result && !(result instanceof Element) && !(typeof result === 'function'))

    if (typeof result === 'function') {
      result = await result()
    }

    if (options.renderLocation != null) {
      let target = await micro.waitForElement(options.renderLocation)
      target.innerHTML = result + ''
    }

    if (event) {
      window.history.pushState({}, '', url)
    }

    if (options.after) await options.after(event)
  }

  window.onpopstate = async event => {
    await routeChangeHandler()
  }

  routeChangeHandler()

  micro.routes = routeMap
}

// TODO seems a bit redundant? can we share code?
window.micro.library = function hashRouter(routeMap, renderLocation = null) {
  // without render location, simply run routeMap fns (client can scroll items into view, etc)
  // TODO validate routeMap
  // TODO run router once on startup

  const { Element } = micro

  const getHash = url => url.split('#')[1]

  const resolvePath = (path, routeMap) => {
    for (let route in routeMap) {
      if (route.replace(/\//ig, '') === path) {
        return routeMap[route]
      }
    }
    // TODO logger.warn
  }

  const hashChangeHandler = async ({ oldURL: oldUrl, newURL: newUrl }) => {
    let hash = getHash(newUrl)
    if (!/\/$/ig.test(hash)) hash += '/'
    let pathFragments = hash.replace(/^\//ig,'').split('/')
    let pathIndex = 0
    let result
    do {
      let path = pathFragments[pathIndex]
      result = resolvePath(path, result || routeMap)
      pathIndex++
    } while (result && !(result instanceof Element) && !(typeof result === 'function'))

    if (typeof result === 'function') {
      result = await result()
    }

    if (renderLocation != null) {
      result = result.render()
      let target = await micro.waitForElement(renderLocation)
      target.innerHTML = result + ''
    }
  }

  window.addEventListener('hashchange', hashChangeHandler)
  hashChangeHandler({ newURL: window.location.href })
}
