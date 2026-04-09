import { describe, it, expect } from 'bun:test'
import { Application } from '@kento/core'
import { bodyParser } from '../src/bodyparser'

function createApp() { return new Application({ silent: true }) }

async function request(app: Application, path = '/', opts: RequestInit = {}): Promise<Response> {
  const handle = app.callback()
  const server = {
    requestIP() {
      return { address: '127.0.0.1' }
    }
  } as any

  return handle(new Request(`http://localhost${path}`, opts), server)
}

describe('bodyParser middleware', () => {
  it('should parse JSON body', async () => {
    const app = createApp()
    app.use(bodyParser())
    app.use(async (ctx) => { ctx.body = (ctx as any).request.body })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
    expect(await res.json()).toEqual({ hello: 'world' })
  })

  it('should parse form body', async () => {
    const app = createApp()
    app.use(bodyParser())
    app.use(async (ctx) => { ctx.body = (ctx as any).request.body })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'foo=bar&baz=qux'
    })
    expect(await res.json()).toEqual({ foo: 'bar', baz: 'qux' })
  })

  it('should parse text body', async () => {
    const app = createApp()
    app.use(bodyParser({ enableTypes: ['text'] }))
    app.use(async (ctx) => { ctx.body = (ctx as any).request.body })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello world'
    })
    expect(await res.text()).toBe('hello world')
  })

  it('should skip GET requests', async () => {
    const app = createApp()
    app.use(bodyParser())
    app.use(async (ctx) => { ctx.body = { parsed: (ctx as any).request.body !== undefined } })
    const res = await request(app)
    expect(await res.json()).toEqual({ parsed: false })
  })

  it('should enforce JSON size limit', async () => {
    const app = createApp()
    app.use(bodyParser({ jsonLimit: '10b' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'a'.repeat(100) })
    })
    expect(res.status).toBe(413)
  })

  it('should enforce strict JSON mode', async () => {
    const app = createApp()
    app.use(bodyParser({ strict: true }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"just a string"'
    })
    expect(res.status).toBe(400)
  })

  it('should store rawBody', async () => {
    const app = createApp()
    app.use(bodyParser())
    app.use(async (ctx) => {
      ctx.body = { raw: (ctx as any).request.rawBody }
    })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}'
    })
    const json: any = await res.json()
    expect(json.raw).toBe('{"key":"value"}')
  })

  it('should handle custom onerror', async () => {
    const app = createApp()
    let errorCaught = false
    app.use(bodyParser({
      jsonLimit: '1b',
      onerror: () => { errorCaught = true }
    }))
    app.use(async (ctx) => { ctx.body = { errorCaught } })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"data": "test"}'
    })
    const json: any = await res.json()
    expect(json.errorCaught).toBe(true)
  })

  it('should ignore text/plain when extendTypes json is provided as a string', async () => {
    const app = createApp()
    app.use(bodyParser({
      enableTypes: ['json'],
      extendTypes: { json: 'application/vnd.api+json' }
    }))
    app.use(async (ctx) => {
      ctx.body = { parsed: (ctx as any).request.body ?? null }
    })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not-json'
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ parsed: null })
  })

  it('should parse custom json content types passed as a string', async () => {
    const app = createApp()
    app.use(bodyParser({
      enableTypes: ['json'],
      extendTypes: { json: 'application/vnd.api+json' }
    }))
    app.use(async (ctx) => {
      ctx.body = (ctx as any).request.body
    })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: JSON.stringify({ ok: true })
    })
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('Security: KSEC-2026-0003 — Body parser streaming limits', () => {
  function makeStreamingBody(totalBytes: number, chunkSize = 256): ReadableStream<Uint8Array> {
    let sent = 0
    return new ReadableStream({
      pull(controller) {
        if (sent >= totalBytes) { controller.close(); return }
        const size = Math.min(chunkSize, totalBytes - sent)
        controller.enqueue(new Uint8Array(size).fill(0x61)) // 'a'
        sent += size
      },
    })
  }

  it('rejects streaming JSON body without Content-Length when it exceeds the limit', async () => {
    const app = createApp()
    app.use(bodyParser({ jsonLimit: '100b' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // no Content-Length set, body is a string bigger than 100 bytes
      body: 'a'.repeat(200),
    })
    expect(res.status).toBe(413)
  })

  it('rejects body when Content-Length is understated and real size exceeds limit', async () => {
    const app = createApp()
    app.use(bodyParser({ jsonLimit: '50b' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    // We send a 200-byte body but tell the client it is only 20 bytes
    const bigBody = 'a'.repeat(200)
    const res = await request(app, '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '20',
      },
      body: bigBody,
    })
    // Content-Length check passes (20 < 50), but streaming read must still stop at 50
    expect(res.status).toBe(413)
  })

  it('enforces limit for form-encoded body without Content-Length', async () => {
    const app = createApp()
    app.use(bodyParser({ formLimit: '30b' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'key=' + 'a'.repeat(100),
    })
    expect(res.status).toBe(413)
  })

  it('enforces limit for text body without Content-Length', async () => {
    const app = createApp()
    app.use(bodyParser({ textLimit: '20b', enableTypes: ['text'] }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'a'.repeat(50),
    })
    expect(res.status).toBe(413)
  })

  it('accepts a body exactly at the limit', async () => {
    const app = createApp()
    app.use(bodyParser({ textLimit: '10b', enableTypes: ['text'] }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'a'.repeat(10),
    })
    expect(res.status).toBe(200)
  })
})
