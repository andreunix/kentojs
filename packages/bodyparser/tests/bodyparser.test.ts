import { describe, it, expect, afterEach } from 'bun:test'
import { Application } from '@kento/core'
import { bodyParser } from '../src/bodyparser'

let servers: any[] = []

function createApp() { return new Application({ silent: true }) }

async function request(app: Application, path = '/', opts: RequestInit = {}): Promise<Response> {
  const server = app.listen(0)
  servers.push(server)
  return fetch(`http://localhost:${server.port}${path}`, opts)
}

afterEach(() => { for (const s of servers) s.stop(); servers = [] })

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
})
