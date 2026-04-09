import { describe, it, expect } from 'bun:test'
import { Application } from '@kento/core'
import { compress } from '../src/compress'

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

describe('compress middleware', () => {
  it('should compress text responses with gzip', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0 }))
    app.use(async (ctx) => {
      ctx.type = 'text'
      ctx.body = 'hello world '.repeat(100)
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'gzip' }
    })
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toContain('Accept-Encoding')
  })

  it('should compress JSON responses', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0 }))
    app.use(async (ctx) => {
      ctx.body = { data: 'x'.repeat(2000) }
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'gzip' }
    })
    expect(res.headers.get('content-encoding')).toBe('gzip')
  })

  it('should fall back to gzip when br is preferred', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0 }))
    app.use(async (ctx) => {
      ctx.body = { data: 'x'.repeat(2000) }
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'br, gzip' }
    })
    expect(res.headers.get('content-encoding')).toBe('gzip')
  })

  it('should not compress below threshold', async () => {
    const app = createApp()
    app.use(compress({ threshold: 10000 }))
    app.use(async (ctx) => {
      ctx.type = 'text'
      ctx.body = 'short'
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'gzip' }
    })
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('should not compress images', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0 }))
    app.use(async (ctx) => {
      ctx.type = 'image/png'
      ctx.body = Buffer.alloc(2000)
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'gzip' }
    })
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('should not compress when Accept-Encoding is identity only', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0 }))
    app.use(async (ctx) => {
      ctx.type = 'text'
      ctx.body = 'hello world '.repeat(100)
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'identity' }
    })
    const encoding = res.headers.get('content-encoding')
    expect(encoding === null || encoding === 'identity').toBe(true)
  })

  it('should not compress 204 responses', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0 }))
    app.use(async (ctx) => { ctx.status = 204 })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'gzip' }
    })
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('should support deflate encoding', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0, br: false, gzip: false }))
    app.use(async (ctx) => {
      ctx.type = 'text'
      ctx.body = 'hello world '.repeat(100)
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'deflate' }
    })
    expect(res.headers.get('content-encoding')).toBe('deflate')
  })

  it('should respect Cache-Control: no-transform', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0 }))
    app.use(async (ctx) => {
      ctx.set('Cache-Control', 'no-transform')
      ctx.type = 'text'
      ctx.body = 'hello world '.repeat(100)
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'gzip' }
    })
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('should not recompress responses that already have Content-Encoding', async () => {
    const app = createApp()
    app.use(compress({ threshold: 0 }))
    app.use(async (ctx) => {
      ctx.type = 'text'
      ctx.set('Content-Encoding', 'br')
      ctx.body = 'hello world '.repeat(100)
    })
    const res = await request(app, '/', {
      headers: { 'Accept-Encoding': 'gzip' }
    })
    expect(res.headers.get('content-encoding')).toBe('br')
  })
})
