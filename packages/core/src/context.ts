import { STATUS_CODES, createHttpError, parseCookies } from './utils.ts'

const COOKIES = Symbol('context#cookies')

const context: Record<string, unknown> = {
  toJSON() {
    const self = this as any
    return {
      request: self.request.toJSON(),
      response: self.response.toJSON(),
      app: self.app.toJSON(),
      originalUrl: self.originalUrl,
      platform: self.platform,
      req: '<original request>',
    }
  },

  inspect() {
    const self = this as any
    if (self === context) return self
    return self.toJSON()
  },

  assert(value: unknown, status = 500, message?: string, properties?: object) {
    if (value) return
    ;(this as any).throw(status, message, properties)
  },

  throw(...args: unknown[]) {
    throw createHttpError(...args)
  },

  onerror(err: Error | null) {
    const self = this as any
    if (err == null) return

    const isNativeError =
      Object.prototype.toString.call(err) === '[object Error]' || err instanceof Error
    if (!isNativeError) err = new Error(`non-error thrown: ${JSON.stringify(err)}`)

    self.app.emit('error', err, self)

    let statusCode = (err as any).status || (err as any).statusCode
    if (typeof statusCode !== 'number' || !STATUS_CODES[statusCode]) {
      statusCode = 500
    }

    const msg = (err as any).expose ? err.message : (STATUS_CODES[statusCode] || 'Internal Server Error')
    ;(err as any).status = statusCode
    self._status = statusCode
    self.response._status = statusCode
    self.response._headers = new Headers()

    // Set error headers if present
    if ((err as any).headers) {
      const errorHeaders = (err as any).headers as Record<string, string>
      for (const [k, v] of Object.entries(errorHeaders)) {
        self.response.set(k, v)
      }
    }

    self.response.set('Content-Type', 'text/plain; charset=utf-8')
    self.response._body = msg
    self.response.set('Content-Length', String(Buffer.byteLength(msg)))
  },

  get cookies(): Record<string, string> {
    const self = this as any
    if (!self[COOKIES as any]) {
      const cookieHeader = self.req.headers.get('cookie') || ''
      self[COOKIES as any] = parseCookies(cookieHeader)
    }
    return self[COOKIES as any]
  },

  set cookies(val: Record<string, string>) {
    (this as any)[COOKIES as any] = val
  }
}

// Response delegation
const responseDelegations = {
  methods: ['attachment', 'redirect', 'remove', 'vary', 'has', 'set', 'append', 'flushHeaders', 'back'],
  accessors: ['status', 'message', 'body', 'length', 'type', 'lastModified', 'etag'],
  getters: ['headerSent', 'writable']
}

for (const method of responseDelegations.methods) {
  context[method] = function (...args: unknown[]) {
    return ((this as any).response as any)[method](...args)
  }
}

for (const accessor of responseDelegations.accessors) {
  Object.defineProperty(context, accessor, {
    get() { return (this as any).response[accessor] },
    set(val) { (this as any).response[accessor] = val },
    enumerable: true,
    configurable: true
  })
}

for (const getter of responseDelegations.getters) {
  Object.defineProperty(context, getter, {
    get() { return (this as any).response[getter] },
    enumerable: true,
    configurable: true
  })
}

// Request delegation
const requestDelegations = {
  methods: ['acceptsLanguages', 'acceptsEncodings', 'acceptsCharsets', 'accepts', 'get', 'is'],
  accessors: ['querystring', 'idempotent', 'search', 'method', 'query', 'path', 'url'],
  getters: ['origin', 'href', 'subdomains', 'protocol', 'host', 'hostname', 'URL', 'header', 'headers', 'secure', 'stale', 'fresh', 'ips', 'ip']
}

for (const method of requestDelegations.methods) {
  context[method] = function (...args: unknown[]) {
    return ((this as any).request as any)[method](...args)
  }
}

for (const accessor of requestDelegations.accessors) {
  Object.defineProperty(context, accessor, {
    get() { return (this as any).request[accessor] },
    set(val) { (this as any).request[accessor] = val },
    enumerable: true,
    configurable: true
  })
}

for (const getter of requestDelegations.getters) {
  Object.defineProperty(context, getter, {
    get() { return (this as any).request[getter] },
    enumerable: true,
    configurable: true
  })
}

export default context
