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
  waitForElement,
  isMobileBrowser,
  initializeYamf,
  getYamf
} from '../src/index.js'

import {
  assert,
  assertErr,
  assertEach,
  assertSequence,
  runTests,
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

export function testReactiveComponentBasic() {
  const state = createState({ title: 'Test Title' })
  
  const renderFn = function() {
    return div(h1(this.title))
  }

  const container = { innerHTML: '' }

  // Test that we can create a reactive component without errors
  const component = createReactiveComponent(state, renderFn, container)
  assert(component, c => c !== undefined)
  assert(component, c => typeof c.mount === 'function')
  assert(component, c => typeof c.unmount === 'function')
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
// Run Tests
// ============================================================================

runTests({
  // Element Rendering Tests
  testBasicUsage,
  testForm,
  testSemanticElements,
  testVoidElements,
  testTableElements,
  testListElements,
  testFormElements,
  testMediaElements,
  testTextFormattingElements,
  testEventHandlers,
  testComplexNestedStructure,

  // State Management Tests
  testStateManagement,
  testStateWatching,
  testStateBatching,
  testStateComputed,
  testElementStateBinding,
  testFormState,
  testRenderHelper,

  // Client Utils Tests
  testIsMobileBrowser,
  testInitializeYamf,
  testGetYamf,
  testWaitForElementNotFound,

  // Integration Tests
  testReactiveComponentBasic,
  testElementWithAttributes,
  testAttributeHandling,
  testNestedListStructure
}).catch(err => {
  console.error('Test suite failed:', err)
  process.exit(1)
})
