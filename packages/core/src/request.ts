import net from 'node:net'
import {
  isFresh, acceptsTypes, acceptsEncodings, acceptsCharsets, acceptsLanguages, typeIs
} from './utils'

const IP = Symbol('context#ip')

const request: Record<string, unknown> = {
  get header(): Record<string, string> {
    const req = (this as any).req as Request
    const result: Record<string, string> = {}
    req.headers.forEach((v, k) => { result[k] = v })
    return result
  },
  set header(_val) { /* noop in Bun — headers are on the Request */ },

  get headers(): Record<string, string> { return (this as any).header },
  set headers(_val) { /* noop */ },

  get url(): string { return (this as any)._url },
  set url(val: string) {
    (this as any)._url = val
    ;(this as any)._parsedUrl = null
  },

  get origin(): string | null {
    return (this as any).req.headers.get('origin') || null
  },

  get href(): string {
    const self = this as any
    if (/^https?:\/\//i.test(self.originalUrl)) return self.originalUrl
    return `${self.protocol}://${self.host}${self.originalUrl}`
  },

  get method(): string { return (this as any).req.method },

  get path(): string {
    const self = this as any
    const url = self._url as string
    const qIdx = url.indexOf('?')
    return qIdx === -1 ? url : url.slice(0, qIdx)
  },

  set path(path: string) {
    const self = this as any
    const search = self.search
    self.url = path + search
  },

  get query(): Record<string, string> {
    const str = (this as any).querystring
    const c: Record<string, Record<string, string>> = (this as any)._querycache ??= {}
    return c[str] ??= Object.fromEntries(new URLSearchParams(str))
  },

  set query(obj: Record<string, string>) {
    (this as any).querystring = new URLSearchParams(obj).toString()
  },

  get querystring(): string {
    const url = (this as any)._url as string
    const qIdx = url.indexOf('?')
    return qIdx === -1 ? '' : url.slice(qIdx + 1)
  },

  set querystring(str: string) {
    const self = this as any
    const path = self.path
    self.url = str ? `${path}?${str}` : path
  },

  get search(): string {
    const qs = (this as any).querystring
    return qs ? `?${qs}` : ''
  },

  set search(str: string) {
    (this as any).querystring = str.startsWith('?') ? str.slice(1) : str
  },

  get host(): string {
    const self = this as any
    const proxy = self.app.proxy
    let host = proxy ? self.get('X-Forwarded-Host') : ''
    if (!host) host = self.get('Host') || self.get(':authority')
    if (!host) return ''
    host = host.split(',')[0]!.trim()
    // Sanitize: strip userinfo to prevent host header attacks
    if (host.includes('@')) {
      try { host = new URL(`http://${host}`).host } catch { return '' }
    }
    return host
  },

  get hostname(): string {
    const host = (this as any).host
    if (!host) return ''
    if (host[0] === '[') return (this as any).URL.hostname || ''
    return host.split(':', 1)[0]!
  },

  get URL(): URL {
    const self = this as any
    if (!self._parsedUrl) {
      const orig = self.originalUrl || ''
      try {
        self._parsedUrl = new URL(`${self.protocol}://${self.host}${orig}`)
      } catch {
        self._parsedUrl = new URL('http://localhost/')
      }
    }
    return self._parsedUrl
  },

  get fresh(): boolean {
    const self = this as any
    const method = self.method
    const s = self.ctx.status
    if (method !== 'GET' && method !== 'HEAD') return false
    if ((s >= 200 && s < 300) || s === 304) {
      const reqHeaders: Record<string, string | undefined> = {
        'if-none-match': self.get('If-None-Match') || undefined,
        'if-modified-since': self.get('If-Modified-Since') || undefined,
        'cache-control': self.get('Cache-Control') || undefined
      }
      const resHeaders: Record<string, string | undefined> = {
        'etag': self.response.get('ETag') || undefined,
        'last-modified': self.response.get('Last-Modified') || undefined
      }
      return isFresh(reqHeaders, resHeaders)
    }
    return false
  },

  get stale(): boolean { return !(this as any).fresh },

  get idempotent(): boolean {
    return ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE'].includes((this as any).method)
  },

  get charset(): string {
    const ct = (this as any).get('Content-Type')
    if (!ct) return ''
    const match = ct.match(/charset\s*=\s*([^\s;]+)/i)
    return match?.[1] ?? ''
  },

  get length(): number | undefined {
    const len = (this as any).get('Content-Length')
    if (!len) return undefined
    return ~~len
  },

  get protocol(): string {
    const self = this as any
    if (!self.app.proxy) {
      // Bun.serve() with TLS will have the URL start with https://
      try {
        const parsed = new URL(self.req.url)
        return parsed.protocol.replace(':', '')
      } catch {
        return 'http'
      }
    }
    const proto = self.get('X-Forwarded-Proto')
    return proto ? proto.split(',')[0]!.trim() : 'http'
  },

  get secure(): boolean { return (this as any).protocol === 'https' },

  get ips(): string[] {
    const self = this as any
    const proxy = self.app.proxy
    const val = self.get(self.app.proxyIpHeader)
    let ips = proxy && val ? val.split(',').map((v: string) => v.trim()) : []
    if (self.app.maxIpsCount > 0) ips = ips.slice(-self.app.maxIpsCount)
    return ips
  },

  get ip(): string {
    const self = this as any
    if (!self[IP as any]) {
      if (self.ips.length > 0) {
        self[IP as any] = self.ips[0]
      } else {
        // Use Bun server.requestIP()
        const addr = self._server?.requestIP?.(self.req)
        self[IP as any] = addr?.address ?? ''
      }
    }
    return self[IP as any]
  },

  set ip(val: string) { (this as any)[IP as any] = val },

  get subdomains(): string[] {
    const self = this as any
    const offset = self.app.subdomainOffset
    const hostname = self.hostname
    if (net.isIP(hostname)) return []
    return hostname.split('.').reverse().slice(offset)
  },

  accepts(...args: string[]) {
    const self = this as any
    return acceptsTypes(self.get('Accept'), ...args)
  },

  acceptsEncodings(...args: string[]) {
    const self = this as any
    return acceptsEncodings(self.get('Accept-Encoding'), ...args)
  },

  acceptsCharsets(...args: string[]) {
    const self = this as any
    return acceptsCharsets(self.get('Accept-Charset'), ...args)
  },

  acceptsLanguages(...args: string[]) {
    const self = this as any
    return acceptsLanguages(self.get('Accept-Language'), ...args)
  },

  is(type: string, ...types: string[]) {
    return typeIs((this as any).get('Content-Type'), type, ...types)
  },

  get type(): string {
    const type = (this as any).get('Content-Type')
    if (!type) return ''
    return type.split(';')[0]!.trim()
  },

  get(field: string): string {
    const req = (this as any).req as Request
    const lower = field.toLowerCase()
    if (lower === 'referer' || lower === 'referrer') {
      return req.headers.get('referer') || req.headers.get('referrer') || ''
    }
    return req.headers.get(lower) || ''
  },

  toJSON() {
    const self = this as any
    return { method: self.method, url: self.url, header: self.header }
  }
}

export default request
