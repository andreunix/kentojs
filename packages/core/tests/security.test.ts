import { describe, it, expect, afterEach } from 'bun:test'
import { Application } from '../src/application'
import { HttpError, createHttpError, escapeHtml, serializeCookie, parseCookies } from '../src/utils'

let servers: any[] = []

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

afterEach(() => { for (const s of servers) s.stop(); servers = [] })

describe('Security: Prototype Pollution', () => {
  it('should not allow __proto__ in HttpError properties', () => {
    const err = new HttpError(400, 'test', { __proto__: { isAdmin: true } } as any)
    expect((err as any).isAdmin).toBeUndefined()
    expect(({} as any).isAdmin).toBeUndefined()
  })

  it('should not allow constructor pollution in HttpError', () => {
    const originalConstructor = HttpError.prototype.constructor
    new HttpError(400, 'test', { constructor: 'hacked' } as any)
    expect(HttpError.prototype.constructor).toBe(originalConstructor)
  })
})

describe('Security: Header Injection (CRLF)', () => {
  it('should strip CRLF from response headers', async () => {
    const app = createApp()
    app.use(async (ctx) => {
      ctx.set('X-Custom', 'value\r\nInjected-Header: evil')
      ctx.body = 'ok'
    })
    const res = await request(app)
    expect(res.headers.get('injected-header')).toBeNull()
    const custom = res.headers.get('x-custom')
    expect(custom).not.toContain('\r')
    expect(custom).not.toContain('\n')
  })

  it('should strip CRLF from appended headers', async () => {
    const app = createApp()
    app.use(async (ctx) => {
      ctx.append('X-Custom', 'value\r\nEvil: injected')
      ctx.body = 'ok'
    })
    const res = await request(app)
    expect(res.headers.get('evil')).toBeNull()
  })
})

describe('Security: Open Redirect', () => {
  it('should allow relative redirects', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.redirect('/safe-path') })
    const res = await request(app, '/', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/safe-path')
  })

  it('should allow http/https redirects', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.redirect('https://example.com/path') })
    const res = await request(app, '/', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('https://example.com')
  })

  it('should block javascript: scheme redirects', async () => {
    const app = createApp()
    app.use(async (ctx) => {
      try {
        ctx.redirect('javascript:alert(1)')
        ctx.body = 'should not reach'
      } catch (err: any) {
        ctx.status = 400
        ctx.body = 'blocked'
      }
    })
    const res = await request(app)
    expect(res.status).toBe(400)
  })

  it('should block data: scheme redirects', async () => {
    const app = createApp()
    app.use(async (ctx) => {
      try {
        ctx.redirect('data:text/html,<script>alert(1)</script>')
        ctx.body = 'should not reach'
      } catch (err: any) {
        ctx.status = 400
        ctx.body = 'blocked'
      }
    })
    const res = await request(app)
    expect(res.status).toBe(400)
  })
})

describe('Security: XSS Prevention', () => {
  it('should escape HTML entities', () => {
    const input = '<script>alert("xss")</script>'
    const escaped = escapeHtml(input)
    expect(escaped).not.toContain('<script>')
    expect(escaped).toContain('&lt;script&gt;')
  })

  it('should escape all dangerous characters', () => {
    expect(escapeHtml('&')).toBe('&amp;')
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('>')).toBe('&gt;')
    expect(escapeHtml('"')).toBe('&quot;')
    expect(escapeHtml("'")).toBe('&#39;')
  })

  it('should not expose 5xx error details to client', async () => {
    const app = createApp()
    app.use(async () => { throw new Error('sensitive database info') })
    const res = await request(app)
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).not.toContain('sensitive database info')
    expect(body).toBe('Internal Server Error')
  })

  it('should expose 4xx error messages', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.throw(400, 'Invalid input') })
    const res = await request(app)
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid input')
  })
})

describe('Security: Cookie Validation', () => {
  it('should reject cookie names with special characters', () => {
    expect(() => serializeCookie('name with spaces', 'val')).toThrow()
    expect(() => serializeCookie('name=equals', 'val')).toThrow()
    expect(() => serializeCookie('name;semi', 'val')).toThrow()
    expect(() => serializeCookie('name\ttab', 'val')).toThrow()
  })

  it('should URL-encode cookie values', () => {
    const result = serializeCookie('name', 'value with spaces & special <chars>')
    expect(result).not.toContain('value with spaces')
    expect(result).toContain(encodeURIComponent('value with spaces & special <chars>'))
  })

  it('should set HttpOnly by default', () => {
    const result = serializeCookie('session', 'abc123')
    expect(result).toContain('HttpOnly')
  })

  it('should not be vulnerable to cookie tossing via parsing', () => {
    // First value for a key should win
    const cookies = parseCookies('session=legit; session=evil')
    expect(cookies.session).toBe('legit')
  })
})

describe('Security: Host Header Attacks', () => {
  it('should sanitize host header with userinfo', async () => {
    const app = createApp()
    app.use(async (ctx) => { ctx.body = ctx.hostname })
    const res = await request(app, '/', {
      headers: { Host: 'evil@example.com' }
    })
    const text = await res.text()
    expect(text).not.toContain('evil@')
  })
})

describe('Security: Error Information Leakage', () => {
  it('should not leak stack traces in production', async () => {
    const app = new Application({ env: 'production', silent: true })
    app.use(async () => { throw new Error('internal failure') })
    const res = await request(app)
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).not.toContain('Error:')
    expect(body).not.toContain('at ')
  })
})

describe('Security: Body Parser Limits', () => {
  it('should reject oversized payloads', async () => {
    const { bodyParser } = await import('../../bodyparser/src/bodyparser')
    const app = createApp()
    app.use(bodyParser({ jsonLimit: '100b' }))
    app.use(async (ctx) => { ctx.body = 'ok' })
    const res = await request(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(200) })
    })
    expect(res.status).toBe(413)
  })
})
