import { describe, it, expect } from 'bun:test'
import { Application } from '@kento/core'
import { rateLimit } from '../src/ratelimit'

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

describe('rateLimit middleware', () => {
  it('should allow requests within limit', async () => {
    const app = createApp()
    app.use(rateLimit({ max: 10, duration: 60000 }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-ratelimit-limit')).toBe('10')
    expect(res.headers.get('x-ratelimit-remaining')).toBeTruthy()
  })

  it('should block requests over limit', async () => {
    const app = createApp()
    const db = new Map()
    app.use(rateLimit({ max: 2, duration: 60000, db }))
    app.use(async (ctx) => { ctx.body = 'ok' })

    await request(app)
    await request(app)
    const res = await request(app)
    expect(res.status).toBe(429)
  })

  it('should set X-RateLimit headers', async () => {
    const app = createApp()
    app.use(rateLimit({ max: 100 }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('x-ratelimit-limit')).toBe('100')
    expect(res.headers.get('x-ratelimit-remaining')).toBeTruthy()
    expect(res.headers.get('x-ratelimit-reset')).toBeTruthy()
  })

  it('should set Retry-After when limited', async () => {
    const app = createApp()
    const db = new Map()
    app.use(rateLimit({ max: 1, duration: 60000, db }))
    app.use(async (ctx) => { ctx.body = 'ok' })

    await request(app)
    const res = await request(app)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
  })

  it('should support whitelist', async () => {
    const app = createApp()
    const db = new Map()
    app.use(rateLimit({
      max: 1,
      duration: 60000,
      db,
      whitelist: () => true
    }))
    app.use(async (ctx) => { ctx.body = 'ok' })

    await request(app)
    await request(app)
    const res = await request(app)
    expect(res.status).toBe(200)
  })

  it('should support disabling headers', async () => {
    const app = createApp()
    app.use(rateLimit({ disableHeader: true }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('x-ratelimit-limit')).toBeNull()
  })

  it('should support custom status code', async () => {
    const app = createApp()
    const db = new Map()
    app.use(rateLimit({ max: 1, duration: 60000, db, status: 503 }))
    app.use(async (ctx) => { ctx.body = 'ok' })

    await request(app)
    const res = await request(app)
    expect(res.status).toBe(503)
  })

  it('should support custom id function', async () => {
    const app = createApp()
    app.use(rateLimit({
      max: 100,
      id: () => 'global-key'
    }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.status).toBe(200)
  })

  it('should support id returning false to skip', async () => {
    const app = createApp()
    const db = new Map()
    app.use(rateLimit({
      max: 1,
      duration: 60000,
      db,
      id: () => false
    }))
    app.use(async (ctx) => { ctx.body = 'ok' })

    await request(app)
    await request(app)
    const res = await request(app)
    expect(res.status).toBe(200)
  })
})
