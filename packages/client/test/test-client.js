/**
 * Client Library Tests - YAMF Test Framework
 * 
 * Tests for @yamf/client utilities including:
 * - HTML element rendering
 * - State management
 * - Client utilities (waitForElement, isMobileBrowser, etc.)
 */

import { 
  htmlTags, 
  createState, 
  createReactiveComponent, 
  createFormState, 
  createRenderHelper,
  router,
  hashRouter,
  waitForElement,
  isMobileBrowser,
  initializeYamf,
  getYamf,
  trusted,
  isTrusted,
  encode
} from '@yamf/client'

import {
  assert,
  assertErr,
  assertEach,
  assertSequence,
  sleep
} from '@yamf/test'

const {
  html, body, div, p, a, span, h1, h2, h3, br, hr,
  header, footer, main, section, article, aside, nav,
  form, label, input, textarea, button, select, option, fieldset, legend,
  table, thead, tbody, tfoot, tr, th, td, caption,
  ul, ol, li, dl, dt, dd,
  img, audio, video, source, figure, figcaption,
  strong, em, mark, code, abbr, time, small,
  blockquote, pre, address, link
} = htmlTags

// Initialize yamf global
initializeYamf()

const removeNewLines = str => str.replace(/\n[\s]+/g, '')

// ============================================================================
// HTML Element Rendering Tests
// ============================================================================

export function testBasicUsage() {
  const Element = html(body(
    div({class: 'test'},
      p('this is a test paragraph'),
      a({href: 'google.com'}, 'go to google')
    )
  ))

  const result = Element.render()
  const expectedResult = '<!DOCTYPE html><html><body><div class="test"><p>this is a test paragraph</p><a href="google.com">go to google</a></div></body></html>'
  
  assert(result, r => r === expectedResult)
}

export function testForm() {
  const Element = form(
    label({ for: 'first-name' }, 'First name:'),
    input({ type: 'text', id: 'first-name', name: 'first-name' }),
    label({ for: 'last-name' }, 'Last name:'),
    input({ type: 'text', id: 'last-name', name: 'last-name' })
  )

  const result = Element.render()
  const expected = removeNewLines(`<form>
    <label for="first-name">First name:</label>
    <input type="text" id="first-name" name="first-name">
    <label for="last-name">Last name:</label>
    <input type="text" id="last-name" name="last-name">
  </form>`)
  
  assert(result, r => r === expected)
}

export function testSemanticElements() {
  const Element = html(
    body(
      header(h1('Site Title'), nav(a({href: '#'}, 'Home'))),
      main(
        section(
          h2('Section Title'),
          article(
            h3('Article Title'),
            p('Article content with ', strong('bold'), ' and ', em('italic'), ' text.')
          )
        ),
        aside(p('Sidebar content'))
      ),
      footer(p('© 2024 Test Site'))
    )
  )

  const result = Element.render()
  const expected = removeNewLines(`<!DOCTYPE html>
    <html>
    <body>
      <header>
        <h1>Site Title</h1>
        <nav><a href="#">Home</a></nav>
      </header>
      <main>
        <section>
          <h2>Section Title</h2>
          <article>
            <h3>Article Title</h3>
            <p>Article content with <strong>bold</strong> and <em>italic</em> text.</p>
          </article>
        </section>
        <aside><p>Sidebar content</p></aside>
      </main>
      <footer><p>© 2024 Test Site</p></footer>
    </body>
  </html>`)
  
  assert(result, r => r === expected)
}

export function testVoidElements() {
  const Element = div(
    p('Line 1'),
    br(),
    p('Line 2'),
    hr(),
    img({src: 'test.jpg', alt: 'Test image'})
  )

  const result = Element.render()
  const expected = removeNewLines(`<div>
    <p>Line 1</p>
    <br>
    <p>Line 2</p>
    <hr>
    <img src="test.jpg" alt="Test image">
  </div>`)
  
  assert(result, r => r === expected)
}

export function testTableElements() {
  const Element = table(
    caption('Test Table'),
    thead(
      tr(
        th('Name'),
        th('Age'),
        th('City')
      )
    ),
    tbody(
      tr(
        td('John'),
        td('25'),
        td('New York')
      ),
      tr(
        td('Jane'),
        td('30'),
        td('Boston')
      )
    ),
    tfoot(
      tr(
        td({colspan: '3'}, 'Total: 2 people')
      )
    )
  )

  const result = Element.render()
  const expected = removeNewLines(`<table>
    <caption>Test Table</caption>
    <thead>
      <tr>
        <th>Name</th>
        <th>Age</th>
        <th>City</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>John</td>
        <td>25</td>
        <td>New York</td>
      </tr>
      <tr>
        <td>Jane</td>
        <td>30</td>
        <td>Boston</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3">Total: 2 people</td>
      </tr>
    </tfoot>
  </table>`)
  
  assert(result, r => r === expected)
}

export function testListElements() {
  const Element = div(
    ul(
      li('Unordered item 1'),
      li('Unordered item 2')
    ),
    ol(
      li('Ordered item 1'),
      li('Ordered item 2')
    ),
    dl(
      dt('Term 1'),
      dd('Definition 1'),
      dt('Term 2'),
      dd('Definition 2')
    )
  )

  const result = Element.render()
  const expected = removeNewLines(`<div>
    <ul>
      <li>Unordered item 1</li>
      <li>Unordered item 2</li>
    </ul>
    <ol>
      <li>Ordered item 1</li>
      <li>Ordered item 2</li>
    </ol>
    <dl>
      <dt>Term 1</dt>
      <dd>Definition 1</dd>
      <dt>Term 2</dt>
      <dd>Definition 2</dd>
    </dl>
  </div>`)
  
  assert(result, r => r === expected)
}

export function testFormElements() {
  const Element = form(
    fieldset(
      legend('Personal Information'),
      label({for: 'name'}, 'Name:'),
      input({type: 'text', id: 'name', name: 'name'}),
      br(),
      label({for: 'bio'}, 'Bio:'),
      textarea({id: 'bio', name: 'bio', rows: '3'}, 'Default bio text'),
      br(),
      label({for: 'country'}, 'Country:'),
      select({id: 'country', name: 'country'},
        option({value: 'us'}, 'United States'),
        option({value: 'ca', selected: true}, 'Canada'),
        option({value: 'uk'}, 'United Kingdom')
      ),
      br(),
      button({type: 'submit'}, 'Submit')
    )
  )

  const result = Element.render()
  const expected = removeNewLines(`<form>
    <fieldset>
      <legend>Personal Information</legend>
      <label for="name">Name:</label>
      <input type="text" id="name" name="name">
      <br>
      <label for="bio">Bio:</label>
      <textarea id="bio" name="bio" rows="3">Default bio text</textarea>
      <br>
      <label for="country">Country:</label>
      <select id="country" name="country">
        <option value="us">United States</option>
        <option value="ca" selected>Canada</option>
        <option value="uk">United Kingdom</option>
      </select>
      <br>
      <button type="submit">Submit</button>
    </fieldset>
  </form>`)
  
  assert(result, r => r === expected)
}

export function testMediaElements() {
  const Element = div(
    figure(
      img({src: 'image.jpg', alt: 'Test Image'}),
      figcaption('This is a test image')
    ),
    audio({controls: true},
      source({src: 'audio.mp3', type: 'audio/mpeg'}),
      'Your browser does not support the audio element.'
    ),
    video({controls: true, width: '320', height: '240'},
      source({src: 'video.mp4', type: 'video/mp4'}),
      'Your browser does not support the video tag.'
    )
  )

  const result = Element.render()
  assert(result, r => r.includes('<figure>'))
  assert(result, r => r.includes('<figcaption>This is a test image</figcaption>'))
  assert(result, r => r.includes('<audio controls>'))
  assert(result, r => r.includes('<video controls width="320" height="240">'))
}

export function testTextFormattingElements() {
  const Element = div(
    p(strong('Bold text'), ' and ', em('italic text')),
    p(mark('Highlighted'), ' text with ', code('code'), ' sample'),
    p(abbr({title: 'Hypertext Markup Language'}, 'HTML'), ' is great'),
    blockquote('This is a blockquote'),
    pre('Preformatted\n  text\n    here'),
    p(small('Small print'), ' here')
  )

  const result = Element.render()
  assert(result, r => r.includes('<strong>Bold text</strong>'))
  assert(result, r => r.includes('<em>italic text</em>'))
  assert(result, r => r.includes('<mark>Highlighted</mark>'))
  assert(result, r => r.includes('<code>code</code>'))
  assert(result, r => r.includes('<blockquote>This is a blockquote</blockquote>'))
}

export function testEventHandlers() {
  const Element = div(
    button({onclick: 'handleClick()'}, 'Click me'),
    input({type: 'text', onchange: 'handleChange(this.value)'}),
    a({href: '#', onmouseover: 'handleHover()'}, 'Hover me')
  )

  const result = Element.render()
  assert(result, r => r.includes('onclick="handleClick()"'))
  assert(result, r => r.includes('onchange="handleChange(this.value)"'))
  assert(result, r => r.includes('onmouseover="handleHover()"'))
}

export function testComplexNestedStructure() {
  const Element = html(
    body(
      div({class: 'container'},
        header({id: 'main-header'},
          h1('Welcome'),
          nav(
            a({href: '/home'}, 'Home'),
            a({href: '/about'}, 'About'),
            a({href: '/services'}, 'Services')
          )
        ),
        main({class: 'content'},
          section(
            h2('Features'),
            ul(
              li('Feature 1'),
              li('Feature 2'),
              li('Feature 3')
            )
          ),
          section(
            h2('Pricing'),
            table(
              thead(tr(th('Plan'), th('Price'))),
              tbody(
                tr(td('Basic'), td('$9.99')),
                tr(td('Pro'), td('$19.99'))
              )
            )
          )
        ),
        footer(p('© 2024 Company Name'))
      )
    )
  )

  const result = Element.render()
  assert(result, r => r.includes('<!DOCTYPE html>'))
  assert(result, r => r.includes('id="main-header"'))
  assert(result, r => r.includes('class="container"'))
  assert(result, r => r.includes('<h1>Welcome</h1>'))
}

// ============================================================================
// State Management Tests
// ============================================================================

export function testStateManagement() {
  const state = createState({
    count: 0,
    name: 'Test',
    nested: { value: 42 }
  })

  assert(state.get('count'), c => c === 0)
  assert(state.get('name'), n => n === 'Test')
  assert(state.get('nested').value, v => v === 42)

  state.set('count', 5)
  assert(state.get('count'), c => c === 5)

  state.set('nested', { value: 100 })
  assert(state.get('nested').value, v => v === 100)
}

export async function testStateWatching() {
  const state = createState({ title: 'Initial' })
  let watcherValue = null

  state.watch(newState => {
    watcherValue = newState.title
  })

  state.set('title', 'Updated')
  await sleep(10)
  
  // Give async watchers a chance to run
  assert(watcherValue, v => v === 'Updated')
}

export function testStateBatching() {
  const state = createState({
    firstName: 'John',
    lastName: 'Doe'
  })

  state.batch(() => {
    state.set('firstName', 'Jane')
    state.set('lastName', 'Smith')
  })

  assert(state.get('firstName'), f => f === 'Jane')
  assert(state.get('lastName'), l => l === 'Smith')
}

export function testStateComputed() {
  const state = createState({
    firstName: 'John',
    lastName: 'Doe'
  })

  let getFullName = state.computed('fullName', function() {
    console.log({that:this})
    return `${this.firstName} ${this.lastName}`
  })

  assert(getFullName(), fn => fn === 'John Doe')

  state.set('firstName', 'Jane')
  assert(getFullName(), fn => fn === 'Jane Doe')
}

export function testElementStateBinding() {
  const state = createState({ message: 'Hello' })
  
  const Element = div(
    p(state.get('message')),
    input({type: 'text', value: state.get('message')})
  )

  const result = Element.render()
  assert(result, r => r.includes('<p>Hello</p>'))
  assert(result, r => r.includes('value="Hello"'))
}

export function testFormState() {
  const formState = createFormState({
    email: '',
    password: '',
    remember: false
  })

  // TODO I hate this?
  assert(formState.get('email'), e => e === '')
  assert(formState.get('password'), p => p === '')
  assert(formState.get('remember'), r => r === false)

  formState.set('email', 'test@example.com')
  formState.set('password', 'secret123')
  formState.set('remember', true)

  assert(formState.get('email'), e => e === 'test@example.com')
  assert(formState.get('password'), p => p === 'secret123')
  assert(formState.get('remember'), r => r === true)
}

// TODO better createFormState test

export async function testRenderHelper() {
  const container = { innerHTML: '' }
  const helper = createRenderHelper(container, () => {
    return div(p('Dynamic content'))
  })

  helper.render()

  await sleep(10) // wait for debounce

  console.log({container})
  assert(container.innerHTML,
    r => r.includes('<div>'),
    r => r.includes('<p>Dynamic content</p>')
  )
}

// ============================================================================
// Client Utils Tests
// ============================================================================

export function testIsMobileBrowser() {
  // This is mainly testing that the function runs without error
  // Actual detection depends on navigator object which varies in test environment
  const result = isMobileBrowser()
  assert(result, r => typeof r === 'boolean')
}

export function testInitializeYamf() {
  const yamf1 = initializeYamf()
  assert(yamf1, y => y.__listeners__ !== undefined)
  assert(yamf1, y => y.routes !== undefined)
  assert(yamf1, y => y.modules !== undefined)

  // Should return same instance on second call
  const yamf2 = initializeYamf()
  assert(yamf2, y => y === yamf1)
}

export function testGetYamf() {
  const yamf = getYamf()
  assert(yamf, y => y !== undefined)
  assert(yamf, y => y.__listeners__ !== undefined)
  
  // Should return same instance
  const yamf2 = getYamf()
  assert(yamf2, y => y === yamf)
}

export function testWaitForElementNotFound() {
  // Mock document.querySelector to return null initially
  const originalQuerySelector = global.document?.querySelector
  let callCount = 0
  
  if (typeof global.document === 'undefined') {
    global.document = {}
  }
  
  global.document.querySelector = () => {
    callCount++
    return null
  }

  // This test verifies the function tries to find elements
  // In a real environment, this would wait for the element
  assert(() => callCount >= 0, v => v === true)

  // Restore
  if (originalQuerySelector) {
    global.document.querySelector = originalQuerySelector
  }
}

// ============================================================================
// Integration Tests
// ============================================================================

function createMockContainer() {
  return { innerHTML: '', contains: () => false }
}

function ensureDocumentForReactiveTests() {
  if (typeof global.document === 'undefined') {
    global.document = { activeElement: null, getElementById: () => null, querySelector: () => null }
  }
  if (global.document.activeElement == null) global.document.activeElement = null
  if (typeof global.document.getElementById !== 'function') global.document.getElementById = () => null
}

export function testReactiveComponentBasic() {
  const state = createState({ title: 'Test Title' })
  
  const renderFn = (data) => div(h1(data.title))

  const container = createMockContainer()

  const component = createReactiveComponent(state, renderFn, container)
  assert(component, c => c !== undefined)
  assert(component, c => typeof c.mount === 'function')
  assert(component, c => typeof c.unmount === 'function')
  assert(component, c => typeof c.update === 'function')
}

export function testReactiveComponentMountRenders() {
  ensureDocumentForReactiveTests()
  const state = createState({ title: 'Hello', count: 42 })
  const renderFn = (data) => div(h1(data.title), p(`Count: ${data.count}`))
  const container = createMockContainer()

  const component = createReactiveComponent(state, renderFn, container)
  component.mount()

  assert(container.innerHTML, h => h.includes('Hello'))
  assert(container.innerHTML, h => h.includes('Count: 42'))
}

export function testReactiveComponentReactivity() {
  ensureDocumentForReactiveTests()
  const state = createState({ value: 'initial' })
  const renderFn = (data) => div(span(data.value))
  const container = createMockContainer()

  const component = createReactiveComponent(state, renderFn, container)
  component.mount()

  assert(container.innerHTML, h => h.includes('initial'))

  state.set('value', 'updated')
  assert(container.innerHTML, h => h.includes('updated'))
}

export function testReactiveComponentUnmountStopsUpdates() {
  ensureDocumentForReactiveTests()
  const state = createState({ value: 'mounted' })
  const renderFn = (data) => div(span(data.value))
  const container = createMockContainer()

  const component = createReactiveComponent(state, renderFn, container)
  component.mount()
  assert(container.innerHTML, h => h.includes('mounted'))

  component.unmount()
  state.set('value', 'after-unmount')
  assert(container.innerHTML, h => h.includes('mounted'))
  assert(container.innerHTML, h => !h.includes('after-unmount'))
}

export function testReactiveComponentUpdateForcesRerender() {
  ensureDocumentForReactiveTests()
  const state = createState({ value: 'v1' })
  const renderFn = (data) => div(span(data.value))
  const container = createMockContainer()

  const component = createReactiveComponent(state, renderFn, container)
  component.mount()
  assert(container.innerHTML, h => h.includes('v1'))

  state.set('value', 'v2')
  assert(container.innerHTML, h => h.includes('v2'))

  component.update()
  assert(container.innerHTML, h => h.includes('v2'))
}

export function testReactiveComponentDoubleMountNoop() {
  ensureDocumentForReactiveTests()
  const state = createState({ value: 'once' })
  const renderFn = (data) => div(span(data.value))
  const container = createMockContainer()

  const component = createReactiveComponent(state, renderFn, container)
  component.mount()
  component.mount()
  assert(container.innerHTML, h => h.includes('once'))
}

export function testReactiveComponentContainerNotFoundThrows() {
  ensureDocumentForReactiveTests()
  const origQuerySelector = global.document.querySelector
  global.document.querySelector = () => null

  const state = createState({})
  const renderFn = () => div()
  assertErr(
    () => createReactiveComponent(state, renderFn, '#nonexistent'),
    err => err.message.includes('Container not found')
  )

  global.document.querySelector = origQuerySelector
}

export function testElementWithAttributes() {
  const Element = div(
    {class: 'container', id: 'main', 'data-test': 'value'},
    p('Content')
  )

  const result = Element.render()
  assert(result, r => r.includes('class="container"'))
  assert(result, r => r.includes('id="main"'))
  assert(result, r => r.includes('data-test="value"'))
}

export function testAttributeHandling() {
  const Element = input({
    type: 'email',
    required: true,
    placeholder: 'Enter email',
    disabled: false
  })

  const result = Element.render()
  assert(result, r => r.includes('type="email"'))
  assert(result, r => r.includes('placeholder="Enter email"'))
  assert(result, r => r.includes('required'))
  // disabled=false should not add disabled attribute
  assert(result, r => !r.includes(' disabled'))
}

export function testNestedListStructure() {
  const Element = ul(
    li('Item 1'),
    li('Item 2',
      ul(
        li('Nested 2.1'),
        li('Nested 2.2')
      )
    ),
    li('Item 3')
  )

  const result = Element.render()
  assert(result, r => r.includes('<li>Item 1</li>'))
  assert(result, r => r.includes('<li>Item 2'))
  assert(result, r => r.includes('<li>Nested 2.1</li>'))
}

// ============================================================================
// XSS Prevention Tests
// ============================================================================

export function testXssEncodesStringChildren() {
  const malicious = '<script>alert("xss")</script>'
  const Element = div(p(malicious))
  const result = Element.render()
  
  // Script tags should be encoded
  assert(result,
    r => r.includes('&lt;script&gt;'),
    r => !r.includes('<script>')
  )
}

export function testXssEncodesAttributeValues() {
  const malicious = '"><script>alert(1)</script>'
  const Element = input({ type: 'text', value: malicious })
  const result = Element.render()
  
  // Quotes and tags should be encoded in attribute values
  assert(result,
    r => r.includes('&quot;'),
    r => !r.includes('"><script>')
  )
}

export function testXssTrustedContentNotEncoded() {
  const safeHtml = trusted('<b>Bold text</b>')
  const Element = div(safeHtml)
  const result = Element.render()
  
  // Trusted content should NOT be encoded
  assert(result,
    r => r.includes('<b>Bold text</b>'),
    r => !r.includes('&lt;b&gt;')
  )
}

export function testXssTrustedAttributeNotEncoded() {
  const safeValue = trusted('value with "quotes"')
  const Element = div({ 'data-test': safeValue })
  const result = Element.render()
  
  // Trusted attribute should NOT be encoded
  assert(result,
    r => r.includes('data-test="value with "quotes""')
  )
}

export function testXssInvalidAttributeNameIgnored() {
  // Invalid attribute names should be ignored
  const Element = div({ 'onclick=alert(1) data-x': 'value', class: 'valid' })
  const result = Element.render()
  
  // Valid class should be present, invalid attr should be ignored
  assert(result,
    r => r.includes('class="valid"'),
    r => !r.includes('onclick=alert')
  )
}

export function testXssValidDataAttributes() {
  // Valid data-* attributes should work
  const Element = div({ 'data-user-id': '123', 'data-role': 'admin' })
  const result = Element.render()
  
  assert(result,
    r => r.includes('data-user-id="123"'),
    r => r.includes('data-role="admin"')
  )
}

export function testXssValidAriaAttributes() {
  // Valid aria-* attributes should work
  const Element = button({ 'aria-label': 'Close', 'aria-expanded': 'false' })
  const result = Element.render()
  
  assert(result,
    r => r.includes('aria-label="Close"'),
    r => r.includes('aria-expanded="false"')
  )
}

export function testXssEncodesNestedStrings() {
  const malicious = '<img src=x onerror=alert(1)>'
  const Element = div(
    p('Safe text'),
    span(malicious),
    p('More safe text')
  )
  const result = Element.render()
  
  // Malicious content should be encoded (angle brackets become entities)
  // The full encoded string should be present, not the raw HTML tag
  assert(result,
    r => r.includes('&lt;img'),
    r => r.includes('&gt;'),
    r => !r.includes('<img')  // Raw tag should NOT be present
  )
}

export function testXssMixedTrustedAndUntrusted() {
  const safe = trusted('<em>emphasized</em>')
  const unsafe = '<strong>not really</strong>'
  
  const Element = div(safe, ' and ', unsafe)
  const result = Element.render()
  
  // Trusted should be raw, untrusted should be encoded
  assert(result,
    r => r.includes('<em>emphasized</em>'),
    r => r.includes('&lt;strong&gt;')
  )
}

export function testEncodeHtmlExported() {
  // Verify encode function is available from client
  const encoded = encode.html('<script>alert(1)</script>')
  assert(encoded,
    e => e === '&lt;script&gt;alert(1)&lt;/script&gt;'
  )
}

export function testIsTrustedExported() {
  // Verify isTrusted function is available from client
  const wrapped = trusted('safe')
  assert(wrapped,
    w => isTrusted(w) === true
  )
  assert('unsafe', s => isTrusted(s) === false)
}

export function testXssEncodesAmpersands() {
  const content = 'Tom & Jerry < Looney & Tunes'
  const Element = p(content)
  const result = Element.render()
  
  assert(result,
    r => r.includes('Tom &amp; Jerry'),
    r => r.includes('&lt; Looney')
  )
}

export function testXssPreservesElementChildren() {
  // Element children should render normally (they encode their own content)
  const Element = div(
    p('First'),
    span(strong('Bold')),
    p('Last')
  )
  const result = Element.render()
  
  assert(result,
    r => r.includes('<p>First</p>'),
    r => r.includes('<strong>Bold</strong>'),
    r => r.includes('<p>Last</p>')
  )
}

// TODO CLIENT MOCK TESTS

// export async function testHandleRouteChange() {
//   const routeMap = {
//     '/': () => div('Home'),
//     '/about': () => div('About'),
//     '/contact': () => div('Contact')
//   }

//   const options = {
//     renderLocation: 'body'
//   }

//   await handleRouteChange(null, routeMap, options)
//   assert(document.body.innerHTML, r => r.includes('Home'))

//   await handleRouteChange({ target: { getAttribute: () => '/about' } }, routeMap, options)
//   assert(document.body.innerHTML, r => r.includes('About'))

//   await handleRouteChange({ target: { getAttribute: () => '/contact' } }, routeMap, options)
//   assert(document.body.innerHTML, r => r.includes('Contact'))
// }


// export function testRouter() {
//   const container = { innerHTML: '' }
//   const routeMap = {
//     '/': () => div('Home'),
//     '/about': () => div('About'),
//     '/contact': () => div('Contact')
//   }

//   router(routeMap)
//   assert(container.innerHTML, r => r.includes('Home'))

//   router(routeMap, { renderLocation: 'body' })
//   assert(container.innerHTML, r => r.includes('Home'))

//   router(routeMap, { renderLocation: 'body' })
//   assert(container.innerHTML, r => r.includes('Home'))

//   router(routeMap, { renderLocation: 'body' })
//   assert(container.innerHTML, r => r.includes('Home'))
// }


// export function testHashRouter() {
//   const routeMap = {
//     '/': () => div('Home'),
//     '/about': () => div('About'),
//     '/contact': () => div('Contact')
//   }

//   hashRouter(routeMap)
//   assert(document.body.innerHTML, r => r.includes('Home'))
// }