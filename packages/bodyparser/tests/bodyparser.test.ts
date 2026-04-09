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
