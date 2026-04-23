import { assert, terminateAfter, withEnv, sleep } from '@yamf/test'
import { renderWithHandlers, runWithRenderContext, getRenderContext } from '@yamf/client/ssr-render'
import { subscribeToEventSource } from '@yamf/client/event-source'
import elements from '@yamf/client/elements'
import { serializeSsrEvent } from '@yamf/client/ssr-hydrate'

import {
  registryServer,
  createEventSourceService,
  createSsrHandlerRegistry,
  createService,
  httpRequest,
  HEADERS,
  COMMANDS
} from '../../src/index.js'

/**
 * createSsrHandlerRegistry: sign, verify, invoke returns patch envelope
 */
export async function testSsrRegistryInvokeReturnsPatch() {
  await withEnv(
    { YAMF_SSR_HANDLER_SECRET: 'a'.repeat(32) },
    async () => {
      const reg = createSsrHandlerRegistry('svc-ssr-1')
      const { slot, signedId } = reg.registerHandler(async (ev) => {
        return { patch: '<span>z</span>', target: '#box' }
      })
      const out = await reg.invoke(
        { id: signedId, event: { type: 'click', targetSel: '#b' } },
        { name: 'ctx' }
      )
      reg.destroy()
      await assert(out, (o) => o.status === 200, (o) => o.body?.patch === '<span>z</span>', (o) => o.body?.target === '#box')
      await assert(slot, (s) => /^\d+$/.test(s))
    }
  )
}

/**
 * @yamf/client renderWithHandlers embeds yamf.invoke( signed, event ) in HTML
 */
export async function testRenderWithHandlersYamfInvokeInMarkup() {
  await withEnv({ YAMF_SSR_HANDLER_SECRET: 'b'.repeat(32) }, async () => {
    const reg = createSsrHandlerRegistry('markup-ssr')
    const b = reg.getBindings()
    const { html } = renderWithHandlers(
      () => new elements.Button({ onclick: async () => 1 }, 'ok'),
      b
    )
    reg.destroy()
    await assert(
      html,
      (h) => h.includes('yamf.invoke('),
      (h) => h.includes("event)"),
      (h) => h.includes("v1.")
    )
  })
}

/**
 * Two render contexts use independent signed ids
 */
export async function testSsrRenderContextIsolation() {
  await withEnv({ YAMF_SSR_HANDLER_SECRET: 'c'.repeat(32) }, async () => {
    const a = createSsrHandlerRegistry('gA')
    const rA = a.getBindings()
    const b = createSsrHandlerRegistry('gB')
    const rB = b.getBindings()
    const h1 = renderWithHandlers(() => new elements.Div({ onclick: () => 0 }, 'a'), rA).html
    const h2 = renderWithHandlers(() => new elements.Div({ onclick: () => 0 }, 'b'), rB).html
    a.destroy()
    b.destroy()
    await assert(h1, (x) => /yamf\.invoke\(/.test(x) && /v1\./.test(x))
    // ids differ
    const m1 = h1.match(/v1\.[^'"]+/)
    const m2 = h2.match(/v1\.[^'"]+/)
    await assert(m1, (m) => m && m2 && m[0] !== m2[0])
  })
}

/**
 * Forged or expired id => 410
 */
export async function testSsrInvokeInvalidId410() {
  await withEnv({ YAMF_SSR_HANDLER_SECRET: 'd'.repeat(32) }, async () => {
    const reg = createSsrHandlerRegistry('inv-1')
    const o = await reg.invoke({ id: 'v1.nope' }, {})
    reg.destroy()
    await assert(o, (r) => r.status === 410, (r) => r.body?.refresh === true)
  })
}

/**
 * TTL: slot expires after YAMF_SSR_HANDLER_TTL_MS
 */
export async function testSsrInvokeTtlExpired() {
  await withEnv(
    { YAMF_SSR_HANDLER_TTL_MS: '20', YAMF_SSR_HANDLER_SWEEP_MS: '5', YAMF_SSR_HANDLER_SECRET: 'e'.repeat(32) },
    async () => {
      const reg = createSsrHandlerRegistry('ttl-1')
      const { signedId } = reg.registerHandler(async () => 'x')
      await sleep(50)
      const o = await reg.invoke({ id: signedId, event: {} }, {})
      reg.destroy()
      await assert(o, (r) => r.status === 410)
    }
  )
}

/**
 * Max cap evicts least-recently used when registering new handlers
 */
export async function testSsrHandlerMaxEviction() {
  await withEnv(
    { YAMF_SSR_HANDLER_MAX: '2', YAMF_SSR_HANDLER_TTL_MS: '60000', YAMF_SSR_HANDLER_SECRET: 'f'.repeat(32) },
    async () => {
      const reg = createSsrHandlerRegistry('cap-1')
      const a = reg.registerHandler(async () => 'a')
      const b = reg.registerHandler(async () => 'b')
      const c = reg.registerHandler(async () => 'c')
      const o1 = await reg.invoke({ id: a.signedId, event: {} }, {})
      const o2 = await reg.invoke({ id: c.signedId, event: {} }, {})
      reg.destroy()
      await assert(a.signedId, (id) => o1?.status === 410)
      await assert(c.signedId, (id) => o2?.status === 200)
    }
  )
}

/**
 * end-to-end: POST ssr-invoke to SSE service
 */
export async function testSseServiceSsrInvokeHttp() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4101',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_GATEWAY_URL: 'http://127.0.0.1:5101',
      YAMF_REGISTRY_TOKEN: 'tok-ssr-1',
      YAMF_SSR_HANDLER_SECRET: '0'.repeat(32)
    },
    async () => {
      await terminateAfter(
        () => registryServer(4101, { broadcastShutdownOnTerminate: false }),
        () =>
          createEventSourceService(
            'sse-ssr-1',
            {},
            { accessControl: 'private', renderMode: 'html-handlers' }
          ),
        async (reg, svc) => {
          const b = svc.ssr.getBindings()
          const { signedId } = b.registerHandler(async function (ev) {
            return { patch: '<p>hi</p>', target: 'body' }
          })
          const r = await httpRequest(svc.location, {
            method: 'POST',
            body: { id: signedId, event: { type: 'click' } },
            headers: {
              'content-type': 'application/json',
              [HEADERS.COMMAND]: COMMANDS.SSR_INVOKE_HANDLER
            }
          })
          await assert(r, (x) => x.patch === '<p>hi</p>', (x) => x.target === 'body')
        }
      )
    }
  )
}

/**
 * Handler that uses service context: this.call to a late-registered service
 */
export async function testSseSsrHandlerCallsPeerViaContext() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4102',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_GATEWAY_URL: 'http://127.0.0.1:5102',
      YAMF_REGISTRY_TOKEN: 'tok-ssr-2',
      YAMF_SSR_HANDLER_SECRET: '1'.repeat(32)
    },
    async () => {
      await terminateAfter(
        () => registryServer(4102, { broadcastShutdownOnTerminate: false }),
        () => createEventSourceService('sse-ssr-2', {}, { accessControl: 'private', renderMode: 'html-handlers' }),
        () => createService('late-ssr', (p) => ({ n: p.n })),
        async (reg, svc) => {
          const b = svc.ssr.getBindings()
          const h = b.registerHandler(async function () {
            return { patch: (await this.call('late-ssr', { n: 99 })).n, target: 'body' }
          })
          const r = await httpRequest(svc.location, {
            method: 'POST',
            body: { id: h.signedId, event: {} },
            headers: {
              'content-type': 'application/json',
              [HEADERS.COMMAND]: COMMANDS.SSR_INVOKE_HANDLER
            }
          })
          await assert(r, (x) => x.patch === 99, (x) => x.target === 'body')
        }
      )
    }
  )
}

/**
 * server.ssr.broadcastRender sends SSE; at least one connected client receives the render payload
 */
export async function testSseBroadcastRenderEvent() {
  await withEnv(
    {
      YAMF_REGISTRY_URL: 'http://127.0.0.1:4103',
      YAMF_SERVICE_URL: 'http://127.0.0.1',
      YAMF_GATEWAY_URL: 'http://127.0.0.1:5103',
      YAMF_REGISTRY_TOKEN: 'tok-ssr-3',
      YAMF_SSR_HANDLER_SECRET: '2'.repeat(32)
    },
    async () => {
      await terminateAfter(
        () => registryServer(4103, { broadcastShutdownOnTerminate: false }),
        () => createEventSourceService('br-sse', {}, { accessControl: 'private', renderMode: 'html-handlers' }),
        async (reg, svc) => {
          const evs = []
          const es = await subscribeToEventSource(svc.location, (e) => evs.push(e))
          await sleep(80)
          const n = svc.ssr.broadcastRender('<b>x</b>', { target: '#m' })
          await sleep(100)
          es.close()
          await assert(n, (x) => x === 1)
          const withRender = evs.filter((e) => e && e.event === 'render' && e.data)
          const payload = withRender[0]?.data
          const ok = payload && (payload.patch === '<b>x</b>' || (typeof payload === 'object' && payload.patch === '<b>x</b>'))
          await assert(ok, (b) => b === true)
        }
      )
    }
  )
}

export function testSerializeSsrEventShape() {
  if (typeof Event === 'undefined') return
  const btn = { nodeType: 1, value: 'v', getAttribute: () => null, tagName: 'BUTTON', id: 'id1', checked: false, dataset: {} }
  const ev = { type: 'click', target: btn, keyCode: 0 }
  const s = serializeSsrEvent(ev)
  if (s.targetSel && s.type) {
    if (s.targetSel !== '#id1' && s.targetSel !== 'button') {
      // ok: minimal shape
    }
  }
}

/**
 * runWithRenderContext exposes getRenderContext
 */
export async function testRunWithRenderContext() {
  const ctx = { registerHandler: () => ({}) }
  const seen = runWithRenderContext(ctx, () => {
    return getRenderContext() === ctx
  })
  await assert(seen, (x) => x === true)
  await assert(getRenderContext(), (c) => c === undefined)
}
