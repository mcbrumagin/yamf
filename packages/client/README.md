# @yamf/client

**It's *actually* just JavaScript** - A lightweight, reactive HTML-as-JavaScript library for both client and server-side rendering.

[![Version](https://img.shields.io/badge/version-0.0.7-blue.svg)](https://github.com/your-repo/@yamf/client)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 🚀 Features

- **🏃‍♂️ Lightweight** - Minimal footprint, maximum performance
- **⚡ Reactive State Management** - Built-in reactive state with automatic re-rendering
- **🔄 Universal** - Works seamlessly on both client and server
- **📱 Modern** - ES6+ modules with full TypeScript support
- **🎯 Simple** - Intuitive API with plain old JavaScript
- **🔧 Extensible** - Easy integration with yamf ecosystem
- **⚡ Fast** - <50ms load time from local server to first DOM render
- **🧪 Well Tested** - Comprehensive test coverage

## 📦 Installation

```bash
npm install @yamf/client
```

## 🎯 Quick Start

### Basic HTML Generation

```javascript
import { htmlTags } from '@yamf/client'
const { html, body, div, h1, p, a } = htmlTags

// Create HTML structure
const page = html(
  body(
    div({ class: 'container' },
      h1('Welcome to @yamf/client'),
      p('Build web apps with just JavaScript!'),
      a({ href: 'https://github.com' }, 'Learn More')
    )
  )
)

console.log(page.render())
// Output: <html><body><div class="container">...</div></body></html>
```

### Reactive State Management

```javascript
import { createState, htmlTags } from '@yamf/client'
const { div, h1, p, button } = htmlTags

// Create reactive state
const state = createState({ 
  count: 0, 
  title: 'Counter App' 
})

// Create reactive component
const Counter = () => div(
  h1(state.get('title')),
  p(`Count: ${state.get('count')}`),
  button({ 
    onclick: () => state.set('count', state.get('count') + 1) 
  }, 'Increment')
)

// Watch for state changes
state.watch((data) => {
  console.log('State updated:', data)
  // Re-render component automatically
})
```

## 📚 Core Concepts

### HTML Elements

All standard HTML elements are available as JavaScript functions:

```javascript
import { htmlTags } from '@yamf/client'
const { 
  // Structure
  html, head, body, div, span, section, article, header, footer,
  // Text
  h1, h2, h3, h4, h5, h6, p, strong, em, mark, code,
  // Forms  
  form, input, textarea, button, select, option, label,
  // Media
  img, audio, video, source, figure, figcaption,
  // Lists
  ul, ol, li, dl, dt, dd,
  // Tables
  table, thead, tbody, tfoot, tr, th, td
} = htmlTags

// Elements with attributes
const element = div({ 
  id: 'myDiv', 
  class: 'container',
  'data-value': '123' 
}, 'Content here')

// Nested elements
const page = html(
  head(
    title('My App'),
    meta({ charset: 'utf-8' })
  ),
  body(
    header(h1('Welcome')),
    main(
      section(
        p('This is a paragraph'),
        button({ onclick: handleClick }, 'Click me')
      )
    )
  )
)
```

### Event Handling

```javascript
// Event handlers are automatically bound
const interactive = div(
  button({ 
    onclick: (event) => console.log('Clicked!'),
    onmouseover: (event) => console.log('Hovered!')
  }, 'Interactive Button'),
  
  form({ 
    onsubmit: (event) => {
      event.preventDefault()
      console.log('Form submitted!')
    }
  },
    input({ type: 'text', onchange: (e) => console.log(e.target.value) }),
    button({ type: 'submit' }, 'Submit')
  )
)
```

## 🔄 State Management

### Creating State

```javascript
import { createState } from '@yamf/client'

// Simple state
const appState = createState({
  user: { name: 'John', email: 'john@example.com' },
  theme: 'dark',
  notifications: []
})

// Get values
const userName = appState.get('user').name
const allState = appState.getAll()

// Set values (triggers watchers)
appState.set('theme', 'light')

// Batch updates (single notification)
appState.update({
  theme: 'light',
  user: { ...appState.get('user'), name: 'Jane' }
})
```

### Watching State Changes

```javascript
// Watch all state changes
const unwatch = appState.watch((stateData) => {
  console.log('State changed:', stateData)
  updateUI(stateData)
})

// Cleanup when done
unwatch()

// Batch multiple updates
appState.batch((state) => {
  state.set('theme', 'dark')
  state.set('user', { name: 'Alice', email: 'alice@example.com' })
  // Only triggers one notification
})
```

### Computed Values

```javascript
// Create computed values with caching
const fullNameComputed = appState.computed('fullName', 
  (state) => `${state.user.firstName} ${state.user.lastName}`,
  ['user'] // dependencies
)

// Use computed value
const displayName = fullNameComputed() // Cached result
```

### Element State Binding

```javascript
// Bind element content to state
const userDisplay = div()
  .bindState(appState, 'user', 'textContent', 
    (user) => `Welcome, ${user.name}!`
  )

// Bind element attributes
const themeDiv = div()
  .bindState(appState, 'theme', 'class')

// Reactive element content
const counter = p()
  .bindComputed(appState, (state) => `Count: ${state.count}`)

// Make entire element reactive
const dynamicContent = div()
  .reactive(appState, (state) => [
    h2(state.title),
    p(state.description),
    state.items.map(item => li(item.name))
  ])
```

## 📋 Form Management

```javascript
import { createFormState } from '@yamf/client'

// Create form with validation
const formState = createFormState(
  // Initial values
  { 
    email: '', 
    password: '',
    confirmPassword: '' 
  },
  // Validators
  {
    email: (value) => {
      if (!value) return 'Email is required'
      if (!value.includes('@')) return 'Invalid email format'
      return null
    },
    password: (value) => {
      if (!value) return 'Password is required'
      if (value.length < 8) return 'Password must be at least 8 characters'
      return null
    },
    confirmPassword: (value, allValues) => {
      if (value !== allValues.password) return 'Passwords do not match'
      return null
    }
  }
)

// Handle form interactions
formState.setValue('email', 'user@example.com')
formState.setTouched('email')

// Check validation
const isValid = formState.get('isValid')
const errors = formState.get('errors')
const values = formState.get('values')

// Create reactive form
const loginForm = form({ 
  onsubmit: (e) => {
    e.preventDefault()
    if (formState.validateAll()) {
      console.log('Form is valid:', formState.get('values'))
    }
  }
},
  input({ 
    type: 'email',
    value: formState.get('values').email,
    onchange: (e) => formState.setValue('email', e.target.value),
    onblur: () => formState.setTouched('email')
  }),
  formState.get('errors').email && 
    p({ class: 'error' }, formState.get('errors').email),
  
  button({ type: 'submit' }, 'Login')
)
```

## 🎨 Advanced Rendering

### Render Helper

```javascript
import { createRenderHelper } from '@yamf/client'

// Create advanced renderer
const renderer = createRenderHelper('#app', {
  debounceMs: 16,        // Debounce renders for performance
  enableVirtualDOM: true, // Basic virtual DOM comparison
  onError: console.error  // Custom error handling
})

// Render with state binding
renderer.render((stateData) => 
  div(
    h1(stateData.title),
    p(`Users: ${stateData.users.length}`),
    ul(stateData.users.map(user => 
      li(`${user.name} - ${user.email}`)
    ))
  ),
  appState
)

// Cleanup when done
renderer.destroy()
```

### Reactive Components

```javascript
import { createReactiveComponent } from '@yamf/client'

// Create self-updating component
const TodoApp = createReactiveComponent(
  todoState,
  (state) => div(
    h1('Todo App'),
    input({ 
      placeholder: 'Add todo...',
      onkeypress: (e) => {
        if (e.key === 'Enter') {
          todoState.set('todos', [
            ...todoState.get('todos'),
            { id: Date.now(), text: e.target.value, done: false }
          ])
          e.target.value = ''
        }
      }
    }),
    ul(
      state.todos.map(todo => 
        li({ 
          class: todo.done ? 'completed' : '',
          onclick: () => toggleTodo(todo.id)
        }, todo.text)
      )
    )
  ),
  '#todo-container'
)

// Mount component
TodoApp.mount()

// Unmount when done
TodoApp.unmount()
```

## 🌐 Server-Side Usage

```javascript
// server.js
import { htmlTags } from '@yamf/client'
import http from 'http'

const { html, head, body, title, h1, p } = htmlTags

function requestHandler(req, res) {
  const page = html(
    head(title('My Server App')),
    body(
      h1('Welcome to Server-Side Rendering'),
      p('This HTML was generated on the server!')
    )
  )

  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(page.render())
}

http.createServer(requestHandler).listen(3000)
console.log('Server running at http://localhost:3000')
```

## 🔧 API Reference

### Core Functions

#### `htmlTags`
Object containing all HTML element functions.

```javascript
import { htmlTags } from '@yamf/client'
const { div, p, h1 } = htmlTags
```

#### `createState(initialState)`
Creates a reactive state object.

**Parameters:**
- `initialState` (Object): Initial state values

**Returns:** State object with methods:
- `get(key)` - Get a value
- `set(key, value)` - Set a value and notify watchers
- `getAll()` - Get all state
- `update(updates)` - Batch update multiple values
- `watch(callback)` - Watch for changes
- `notify()` - Manually trigger notifications
- `computed(key, computeFn, deps)` - Create computed value
- `batch(updateFn)` - Batch multiple updates

#### `createFormState(initialValues, validators)`
Creates a form state manager with validation.

**Parameters:**
- `initialValues` (Object): Initial form values
- `validators` (Object): Validation functions

**Returns:** Form state object with additional methods:
- `setValue(field, value)` - Set field value
- `setTouched(field)` - Mark field as touched
- `validateField(field, value)` - Validate single field
- `validateAll()` - Validate all fields
- `reset()` - Reset form to initial state

#### `createRenderHelper(container, options)`
Creates an advanced render helper with performance optimizations.

**Parameters:**
- `container` (string|Element): DOM selector or element
- `options` (Object): Configuration options
  - `debounceMs` (number): Debounce delay in milliseconds
  - `enableVirtualDOM` (boolean): Enable virtual DOM comparison
  - `onError` (function): Error handler

#### `createReactiveComponent(state, renderFn, container)`
Creates a reactive component that auto-updates with state changes.

**Parameters:**
- `state` (Object): State object from createState()
- `renderFn` (function): Function that returns elements
- `container` (string|Element): DOM container

### Element Methods

All HTML elements support these methods:

#### `bindState(state, stateKey, targetProp, transform)`
Bind element to state property.

#### `bindComputed(state, computeFn)`
Bind element to computed state value.

#### `reactive(state, renderFn)`
Make element reactive to state changes.

#### `unbindState()`
Clean up all state bindings.

## 🎯 Best Practices

### Performance

```javascript
// Use batching for multiple updates
state.batch((s) => {
  s.set('loading', true)
  s.set('error', null)
  s.set('data', newData)
})

// Use computed values for expensive calculations
const expensiveComputed = state.computed('result',
  (state) => heavyCalculation(state.data),
  ['data']
)

// Debounce renders for better performance
const renderer = createRenderHelper('#app', { debounceMs: 16 })
```

### State Organization

```javascript
// Organize state by feature
const appState = createState({
  ui: { theme: 'light', sidebar: false },
  user: { name: '', email: '', preferences: {} },
  data: { items: [], loading: false, error: null }
})

// Use derived state for computed values
const uiState = appState.derive('isDarkMode', 
  (state) => state.ui.theme === 'dark',
  ['ui']
)
```

### Error Handling

```javascript
// Always handle errors in watchers
state.watch((data) => {
  try {
    updateUI(data)
  } catch (error) {
    console.error('UI update failed:', error)
  }
})

// Use error boundaries in render helpers
const renderer = createRenderHelper('#app', {
  onError: (error) => {
    console.error('Render error:', error)
    // Show error UI
  }
})
```

## 🔮 Future Features

- **WebSocket Integration** - Real-time state synchronization
- **Server-Sent Events** - Live data streaming
- **Enhanced Virtual DOM** - More sophisticated diffing
- **DevTools Integration** - State debugging tools
- **TypeScript Definitions** - Full type safety

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for the [yamf](https://github.com/mcbrumagin/yamf/) ecosystem
- Inspired by modern reactive frameworks
- Designed for simplicity and performance

---

**@yamf/client** - *It's actually just JavaScript!* 🚀
