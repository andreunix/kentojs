import { describe, it, expect, afterEach } from 'bun:test'
import { Application } from '@kento/core'
import { helmet } from '../src/helmet'

let servers: any[] = []

function createApp() { return new Application({ silent: true }) }

async function request(app: Application, path = '/', opts: RequestInit = {}): Promise<Response> {
  const server = app.listen(0)
  servers.push(server)
  return fetch(`http://localhost:${server.port}${path}`, opts)
}

afterEach(() => { for (const s of servers) s.stop(); servers = [] })

describe('helmet middleware', () => {
  it('should set default security headers', async () => {
    const app = createApp()
    app.use(helmet())
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)

    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(res.headers.get('x-xss-protection')).toBe('0')
    expect(res.headers.get('strict-transport-security')).toBeTruthy()
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('x-dns-prefetch-control')).toBe('off')
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(res.headers.get('origin-agent-cluster')).toBe('?1')
  })

  it('should allow disabling individual headers', async () => {
    const app = createApp()
    app.use(helmet({ frameguard: false, noSniff: false }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)

    expect(res.headers.get('x-frame-options')).toBeNull()
    expect(res.headers.get('x-content-type-options')).toBeNull()
    expect(res.headers.get('referrer-policy')).toBeTruthy() // still enabled
  })

  it('should allow custom CSP directives', async () => {
    const app = createApp()
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", 'cdn.example.com']
        }
      }
    }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    const csp = res.headers.get('content-security-policy')!
    expect(csp).toContain("script-src 'self' cdn.example.com")
  })

  it('should support HSTS with preload', async () => {
    const app = createApp()
    app.use(helmet({ hsts: { maxAge: 31536000, preload: true } }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    const hsts = res.headers.get('strict-transport-security')!
    expect(hsts).toContain('max-age=31536000')
    expect(hsts).toContain('preload')
  })

  it('should support custom referrer policy', async () => {
    const app = createApp()
    app.use(helmet({ referrerPolicy: { policy: 'strict-origin-when-cross-origin' } }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })

  it('should support individual middleware exports', async () => {
    const app = createApp()
    app.use(helmet.noSniff())
    app.use(helmet.frameguard({ action: 'deny' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})
