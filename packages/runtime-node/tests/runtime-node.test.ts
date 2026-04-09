import { describe, expect, it } from 'bun:test'
import { Writable, Readable } from 'node:stream'
import { createNodeRuntime, type NodeFetchApp } from '../src/runtime-node'

function createMockRequest(options: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}) {
  const body = options.body ?? ''
  const rawHeaders = Object.entries(options.headers ?? {}).flatMap(([name, value]) => [name, value])
  const request = Readable.from([body]) as Readable & {
    method?: string
    url?: string
    headers: Record<string, string>
    rawHeaders: string[]
    socket: { remoteAddress?: string | null; encrypted?: boolean }
  }

  request.method = options.method ?? 'GET'
  request.url = options.url
  request.headers = options.headers ?? {}
  request.rawHeaders = rawHeaders
  request.socket = { remoteAddress: '127.0.0.1', encrypted: false }

  return request
}

function createMockResponse() {
  const chunks: Buffer[] = []
  const headers = new Map<string, string | string[]>()

  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  }) as Writable & {
    statusCode: number
    statusMessage: string
    setHeader(name: string, value: string | string[]): void
    getHeader(name: string): string | string[] | undefined
    removeHeader(name: string): void
    bodyText(): string
    headerMap(): Record<string, string | string[] | undefined>
  }

  response.statusCode = 200
  response.statusMessage = 'OK'
  response.setHeader = (name, value) => {
    headers.set(name.toLowerCase(), value)
  }
  response.getHeader = name => headers.get(name.toLowerCase())
  response.removeHeader = name => {
    headers.delete(name.toLowerCase())
  }
  response.bodyText = () => Buffer.concat(chunks).toString('utf8')
  response.headerMap = () => Object.fromEntries(headers.entries())

  return response
}

describe('@kento/runtime-node', () => {
  it('adapts IncomingMessage to Request and Response to ServerResponse', async () => {
    const seen: {
      url?: string
      method?: string
      header?: string | null
      body?: string
      clientAddress?: string | null
      env?: string | undefined
      waited?: boolean
    } = {}

    const app: NodeFetchApp = {
      async fetch(request, platform) {
        seen.url = request.url
        seen.method = request.method
        seen.header = request.headers.get('x-test')
        seen.body = await request.text()
        seen.clientAddress = platform?.clientAddress ?? null
        seen.env = platform?.env.APP_ENV
        platform?.waitUntil(Promise.resolve('done'))
        seen.waited = true

        const headers = new Headers()
        headers.append('x-powered-by', 'kento')
        headers.append('set-cookie', 'session=one; Path=/')
        headers.append('set-cookie', 'theme=dark; Path=/')

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('hello '))
            controller.enqueue(new TextEncoder().encode('runtime'))
            controller.close()
          },
        })

        return new Response(stream, { status: 201, headers })
      },
    }

    const runtime = createNodeRuntime(app, {
      hostname: '127.0.0.1',
      trustProxy: true,
      env: { APP_ENV: 'test' },
    })

    const req = createMockRequest({
      url: '/hello?from=node',
      method: 'POST',
      headers: {
        host: 'example.test',
        'x-test': 'from-client',
        'x-forwarded-for': '203.0.113.7',
      },
      body: 'hello runtime',
    })
    const res = createMockResponse()

    await runtime.handleRequest(req as any, res as any)

    expect(seen.url).toBe('http://example.test/hello?from=node')
    expect(seen.method).toBe('POST')
    expect(seen.header).toBe('from-client')
    expect(seen.body).toBe('hello runtime')
    expect(seen.clientAddress).toBe('203.0.113.7')
    expect(seen.env).toBe('test')
    expect(seen.waited).toBe(true)
    expect(res.statusCode).toBe(201)
    expect(res.bodyText()).toBe('hello runtime')
    expect(res.getHeader('x-powered-by')).toBe('kento')
    expect(res.getHeader('set-cookie')).toEqual([
      'session=one; Path=/',
      'theme=dark; Path=/',
    ])
  })

  it('exposes listen and close as a real server lifecycle', async () => {
    const events: {
      listenedWith?: unknown
      closeCalled: boolean
      callbackCalled: boolean
    } = {
      closeCalled: false,
      callbackCalled: false,
    }

    const fakeServer = {
      listen(options: unknown, callback?: () => void) {
        events.listenedWith = options
        events.callbackCalled = true
        callback?.()
        return fakeServer
      },
      close(callback?: (error?: Error) => void) {
        events.closeCalled = true
        callback?.()
      },
      once() {
        return fakeServer
      },
      on() {
        return fakeServer
      },
      address() {
        return { address: '127.0.0.1', family: 'IPv4', port: 12345 }
      },
    }

    const runtime = createNodeRuntime(
      {
        async fetch() {
          return new Response('ok', { status: 200 })
        },
      },
      {
        port: 12345,
        hostname: '127.0.0.1',
        serverFactory: () => fakeServer as any,
      }
    )

    const server = runtime.listen({ port: 4567, hostname: 'example.test', reusePort: true })
    expect(server).toBe(fakeServer as any)
    expect(events.listenedWith).toEqual({
      port: 4567,
      hostname: 'example.test',
      reusePort: true,
    })
    expect(events.callbackCalled).toBe(true)

    await runtime.close()
    expect(events.closeCalled).toBe(true)
  })
})

describe('Security: KSEC-2026-0001 — Proxy trust boundary', () => {
  it('ignores x-forwarded-proto when trustProxy is false', async () => {
    let capturedUrl = ''
    const app: NodeFetchApp = {
      async fetch(request) {
        capturedUrl = request.url
        return new Response('ok')
      },
    }
    const runtime = createNodeRuntime(app, { trustProxy: false })
    const req = createMockRequest({
      url: '/test',
      method: 'GET',
      headers: {
        host: 'example.test',
        'x-forwarded-proto': 'https',
      },
    })
    const res = createMockResponse()
    await runtime.handleRequest(req as any, res as any)
    // Socket is not encrypted, so protocol must be http regardless of the header
    expect(capturedUrl).toMatch(/^http:\/\//)
    expect(capturedUrl).not.toMatch(/^https:\/\//)
  })

  it('uses x-forwarded-proto when trustProxy is true', async () => {
    let capturedUrl = ''
    const app: NodeFetchApp = {
      async fetch(request) {
        capturedUrl = request.url
        return new Response('ok')
      },
    }
    const runtime = createNodeRuntime(app, { trustProxy: true })
    const req = createMockRequest({
      url: '/test',
      method: 'GET',
      headers: {
        host: 'example.test',
        'x-forwarded-proto': 'https',
      },
    })
    const res = createMockResponse()
    await runtime.handleRequest(req as any, res as any)
    expect(capturedUrl).toMatch(/^https:\/\//)
  })

  it('returns a controlled 400 for a malformed Host header instead of crashing', async () => {
    const app: NodeFetchApp = {
      async fetch() {
        return new Response('ok')
      },
    }
    const runtime = createNodeRuntime(app, {})
    const req = createMockRequest({
      url: '/test',
      method: 'GET',
      headers: { host: 'bad host with spaces' },
    })
    const res = createMockResponse()
    await runtime.handleRequest(req as any, res as any)
    expect(res.statusCode).toBe(400)
  })

  it('falls back to local socket protocol when trustProxy is true but header is absent', async () => {
    let capturedUrl = ''
    const app: NodeFetchApp = {
      async fetch(request) {
        capturedUrl = request.url
        return new Response('ok')
      },
    }
    const runtime = createNodeRuntime(app, { trustProxy: true })
    const req = createMockRequest({
      url: '/path',
      method: 'GET',
      headers: { host: 'example.test' },
    })
    const res = createMockResponse()
    await runtime.handleRequest(req as any, res as any)
    expect(capturedUrl).toMatch(/^http:\/\//)
  })
})
