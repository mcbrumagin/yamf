import http from 'node:http'

function parseSSEMessage(text) {
  const lines = text.split('\n')
  const event = {}
  for (const line of lines) {
    if (line.startsWith(': ')) {
      event.comment = line.slice(2)
    } else if (line.startsWith('event: ')) {
      event.event = line.slice(7)
    } else if (line.startsWith('data: ')) {
      const raw = line.slice(6)
      try {
        event.data = JSON.parse(raw)
      } catch {
        if (raw.trim() === 'undefined') event.data = undefined
        else event.data = raw
      }
    } else if (line.startsWith('id: ')) {
      event.id = line.slice(4)
    }
  }
  if (Object.keys(event).length === 0) return null
  return event
}

class ServerSideEventSource {
  constructor(url) {
    this.url = url

    const { hostname, port, pathname: path }= new URL(url)

    this.requestOptions = {
      hostname,
      port,
      path,
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' }
    }

    this.listeners = {}

    this.start()
    .then(this.openHandler)
    .catch(this.errorHandler)
  }

  dispatchEvent(event) {
    let { id, event: name, data, comment } = event

    if (comment && !id && !name && !data) return
    if (name && this.listeners[name]) {
      this.listeners[name](event) // TODO verify
    }
    if (this.handler) this.handler(event)
  }

  start() {
    return new Promise((resolve, reject) => {
      const req = http.request(this.requestOptions, (res) => {
        let isFirst = true
        let buffer = ''
  
        res.on('data', (chunk) => {
          buffer += chunk.toString()

          if (isFirst) {
            this.openHandler?.(buffer)
            isFirst = false
          }
          // Parse complete SSE messages (double newline delimited)
          const parts = buffer.split('\n\n')
          buffer = parts.pop()
          for (const part of parts) {
            if (!part.trim()) continue
            const event = parseSSEMessage(part)
            if (event) this.dispatchEvent(event)
          }
        })
  
        res.on('end', () => {
          // Parse any remaining buffer
          if (buffer.trim()) {
            const event = parseSSEMessage(buffer)
            if (event) this.dispatchEvent(event)
          }
        })

        this.req = req
        this.res = res
  
        resolve({
          // events,
          response: res,
          close: this.close
        })
      })
  
      req.on('error', err => {
        this.errorHandler?.(err)
        reject(err)
      })
      req.end()
    })
  }

  onmessage(handler) {
    this.handler = handler
  }

  addEventListener(eventName, handler) {
    this.listeners[eventName] = handler
  }

  onopen(handler) {
    this.openHandler = handler
  }

  onerror(handler) {
    this.errorHandler = handler
  }

  close() {
    this.res.destroy()
    this.req.destroy()
  }
  
}

// TODO automatically map service name to url?
export async function subscribeToEventSource(url, channelOrChannelMap, handler) {

  let globalMessageHandler
  let channelMap = {}
  if (typeof channelOrChannelMap === 'function' && !handler) {
    globalMessageHandler = channelOrChannelMap
  } else if (typeof channelOrChannelMap === 'string' && typeof handler === 'function') {
    channelMap[channelOrChannelMap] = handler
  } else if (typeof channelOrChannelMap === 'object') {
    channelMap = channelOrChannelMap
  } else {
    throw new Error('Invalid channel or channel map')
  }

  
  const IsomorphicEventSource = typeof window !== 'undefined' ? EventSource : ServerSideEventSource

  const eventSource = new IsomorphicEventSource(url)

  if (globalMessageHandler) eventSource.onmessage(globalMessageHandler)
  for (let channel in channelMap) {
    eventSource.addEventListener(channel, channelMap[channel])
  }

  return eventSource
}
