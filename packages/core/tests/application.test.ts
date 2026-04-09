import { describe, it, expect, afterEach } from 'bun:test'
import { Application } from '../src/application'

let servers: any[] = []

function createApp() {
  return new Application({ silent: true })
}

async function request(app: Application, path = '/', opts: RequestInit = {}): Promise<Response> {
  const server = app.listen(0)
  servers.push(server)
  const url = `http://localhost:${server.port}${path}`
  return fetch(url, opts)
}

afterEach(() => {
  for (const s of servers) s.stop()
  servers = []
})

describe('Application', () => {
  it('should respond with 404 by default', async () => {
    const app = createApp()
    const res = await request(app)
    expect(res.status).toBe(404)
  })

  it('should respond with middleware body', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = 'hello' })
    const res = await request(app)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
  })

  it('should respond with JSON body', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = { foo: 'bar' } })
    const res = await request(app)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ foo: 'bar' })
  })

  it('should set status code', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.status = 201; ctx.body = 'created' })
    const res = await request(app)
    expect(res.status).toBe(201)
  })

  it('should handle 204 No Content', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.status = 204 })
    const res = await request(app)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('should handle HEAD requests', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = 'hello world' })
    const res = await request(app, '/', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('should set custom headers', async () => {
    const app = createApp()
    app.use(async (ctx) => {
      ctx.set('X-Custom', 'test')
      ctx.body = 'ok'
    })
    const res = await request(app)
    expect(res.headers.get('x-custom')).toBe('test')
  })

  it('should chain middleware', async () => {
    const app = createApp()
    app.use(async (ctx, next) => {
      ctx.set('X-Before', 'yes')
      await next()
      ctx.set('X-After', 'yes')
    })
    app.use(async (ctx) => { ctx.body = 'done' })
    const res = await request(app)
    expect(res.headers.get('x-before')).toBe('yes')
    expect(res.headers.get('x-after')).toBe('yes')
  })

  it('should handle errors gracefully', async () => {
    const app = createApp()
    app.use(async () => { throw new Error('test error') })
    const res = await request(app)
    expect(res.status).toBe(500)
  })

  it('should handle HttpError with status', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.throw(400, 'Bad Request') })
    const res = await request(app)
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Bad Request')
  })

  it('should respond with Buffer body', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = Buffer.from('binary data') })
    const res = await request(app)
    expect(await res.text()).toBe('binary data')
  })

  it('should respond with Blob body', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = new Blob(['blob data']) })
    const res = await request(app)
    expect(await res.text()).toBe('blob data')
  })

  it('should respond with ReadableStream body', async () => {
    const app = createApp()
    app.use(async (ctx) => {
      ctx.body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('stream'))
          controller.close()
        }
      })
    })
    const res = await request(app)
    expect(await res.text()).toBe('stream')
  })

  it('should set content-type for text', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = 'hello' })
    const res = await request(app)
    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  it('should set content-type for html', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = '<h1>hello</h1>' })
    const res = await request(app)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('should set content-type for json', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = { hello: 'world' } })
    const res = await request(app)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('should support ctx.redirect', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.redirect('/new-url') })
    const res = await request(app, '/', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/new-url')
  })

  it('should support use() chaining', () => {
    const app = createApp()
    const result = app.use(async () => {}).use(async () => {})
    expect(result).toBe(app)
  })

  it('should throw on non-function middleware', () => {
    const app = createApp()
    expect(() => app.use('not a function' as any)).toThrow('function')
  })

  it('should support close()', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = 'ok' })
    const server = app.listen(0)
    const port = server.port
    const res = await fetch(`http://localhost:${port}/`)
    expect(res.status).toBe(200)
    app.close()
  })
})

describe('Application context', () => {
  it('should provide request path', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = ctx.path })
    const res = await request(app, '/test/path')
    expect(await res.text()).toBe('/test/path')
  })

  it('should provide request method', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = ctx.method })
    const res = await request(app, '/', { method: 'POST' })
    expect(await res.text()).toBe('POST')
  })

  it('should provide query params', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = ctx.query })
    const res = await request(app, '/?foo=bar&baz=qux')
    const json = await res.json()
    expect(json).toEqual({ foo: 'bar', baz: 'qux' })
  })

  it('should provide hostname', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = ctx.hostname })
    const res = await request(app)
    const text = await res.text()
    expect(text).toBeTruthy()
  })

  it('should provide cookies', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = ctx.cookies })
    const res = await request(app, '/', {
      headers: { Cookie: 'foo=bar; session=abc' }
    })
    const json = await res.json()
    expect(json).toEqual({ foo: 'bar', session: 'abc' })
  })

  it('should provide ip', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = ctx.ip })
    const res = await request(app)
    const text = await res.text()
    expect(text).toBeTruthy()
  })

  it('should support ctx.assert', async () => {
    const app = createApp()
    app.use(async (ctx) => {
      ;(ctx as any).assert(ctx.query.token, 401, 'Token required')
      ctx.body = 'ok'
    })
    const res = await request(app)
    expect(res.status).toBe(401)
  })

  it('should support ctx.state', async () => {
    const app = createApp()
    app.use(async (ctx, next) => { ctx.state.user = 'test'; await next() })
    app.use(async (ctx) => { ctx.body = ctx.state.user })
    const res = await request(app)
    expect(await res.text()).toBe('test')
  })
})
