import { describe, it, expect } from 'bun:test'
import { Application } from '@kento/core'
import { cors } from '../src/cors'

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

describe('cors middleware', () => {
  it('should set Access-Control-Allow-Origin to *', async () => {
    const app = createApp()
    app.use(cors())
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('should set custom origin', async () => {
    const app = createApp()
    app.use(cors({ origin: 'https://example.com' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com')
  })

  it('should handle preflight OPTIONS request', async () => {
    const app = createApp()
    app.use(cors())
    const res = await request(app, '/', {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'POST' }
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toBeTruthy()
  })

  it('should set credentials header', async () => {
    const app = createApp()
    app.use(cors({ credentials: true, origin: 'https://example.com' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('should set expose headers', async () => {
    const app = createApp()
    app.use(cors({ exposeHeaders: ['X-Custom', 'X-Total'] }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('access-control-expose-headers')).toBe('X-Custom,X-Total')
  })

  it('should set max age on preflight', async () => {
    const app = createApp()
    app.use(cors({ maxAge: 3600 }))
    const res = await request(app, '/', {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'POST' }
    })
    expect(res.headers.get('access-control-max-age')).toBe('3600')
  })

  it('should support dynamic origin function', async () => {
    const app = createApp()
    app.use(cors({ origin: async () => 'https://dynamic.com' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://dynamic.com')
  })

  it('should set Vary: Origin', async () => {
    const app = createApp()
    app.use(cors())
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('vary')).toContain('Origin')
  })
})
