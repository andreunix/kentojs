import { extname } from 'node:path'
import {
  STATUS_CODES, EMPTY_STATUSES, REDIRECT_STATUSES,
  escapeHtml, encodeUrl, varyAppend, contentType as resolveContentType, typeIs,
  formatContentDisposition
} from './utils'

const response: Record<string, unknown> = {
  get header(): Record<string, string> {
    const headers = (this as any)._headers as Headers
    const result: Record<string, string> = {}
    headers.forEach((v, k) => { result[k] = v })
    return result
  },

  get headers(): Record<string, string> { return (this as any).header },

  get status(): number { return (this as any)._status ?? 404 },

  set status(code: number) {
    const self = this as any
    if (typeof code !== 'number' || !Number.isInteger(code)) {
      throw new TypeError('status code must be a number')
    }
    if (code < 100 || code > 999) {
      throw new RangeError(`invalid status code: ${code}`)
    }
    self._explicitStatus = true
    self._status = code
    self._statusMessage = STATUS_CODES[code] ?? ''
    if (self.body && EMPTY_STATUSES.has(code)) self.body = null
  },

  get message(): string {
    const self = this as any
    return self._statusMessage || STATUS_CODES[self.status] || ''
  },

  set message(msg: string) { (this as any)._statusMessage = msg },

  get body() { return (this as any)._body },

  set body(val: unknown) {
    const self = this as any
    self._body = val

    if (val == null) {
      if (!EMPTY_STATUSES.has(self.status)) {
        if (self.type === 'application/json') {
          self._body = 'null'
          return
        }
        self.status = 204
      }
      if (val === null) self._explicitNullBody = true
      self.remove('Content-Type')
      self.remove('Content-Length')
      self.remove('Transfer-Encoding')
      return
    }

    if (!self._explicitStatus) self._status = 200

    const setType = !self.has('Content-Type')

    if (typeof val === 'string') {
      if (setType) self.type = /^\s*</.test(val) ? 'html' : 'text'
      self.length = Buffer.byteLength(val)
      return
    }

    if (val instanceof Uint8Array || val instanceof ArrayBuffer || Buffer.isBuffer(val)) {
      if (setType) self.type = 'bin'
      self.length = val instanceof ArrayBuffer ? val.byteLength : (val as Uint8Array).length
      return
    }

    if (val instanceof ReadableStream) {
      if (setType) self.type = 'bin'
      return
    }

    if (val instanceof Blob) {
      if (setType) self.type = 'bin'
      self.length = val.size
      return
    }

    if (val instanceof Response) {
      self._status = val.status
      self._statusMessage = val.statusText
      // Merge headers from the Response
      for (const [key, headerVal] of val.headers.entries()) {
        self.set(key, headerVal)
      }
      return
    }

    // JSON
    self.remove('Content-Length')
    if (!self.type || !/\bjson\b/i.test(self.type)) self.type = 'json'
  },

  set length(n: number) {
    const self = this as any
    if (!self.has('Transfer-Encoding')) self.set('Content-Length', String(n))
  },

  get length(): number | undefined {
    const self = this as any
    if (self.has('Content-Length')) return parseInt(self.get('Content-Length') as string, 10) || 0
    const { body } = self
    if (!body) return undefined
    if (typeof body === 'string') return Buffer.byteLength(body)
    if (Buffer.isBuffer(body)) return body.length
    if (body instanceof Uint8Array) return body.length
    if (body instanceof ArrayBuffer) return body.byteLength
    if (body instanceof Blob) return body.size
    if (body instanceof ReadableStream) return undefined
    return Buffer.byteLength(JSON.stringify(body))
  },

  get headerSent(): boolean { return false },

  vary(field: string) {
    const self = this as any
    const headers = self._headers as Headers
    const current = headers.get('Vary') || ''
    const updated = varyAppend(current, field)
    if (updated) headers.set('Vary', updated)
  },

  redirect(url: string) {
    const self = this as any
    // Prevent redirects to dangerous schemes (javascript:, data:, vbscript:)
    if (url && !url.startsWith('/') && !url.startsWith('.')) {
      if (/^https?:\/\//i.test(url)) {
        url = new URL(url).toString()
      } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
        throw new Error(`Unsafe redirect URL scheme: ${url.split(':')[0]}`)
      }
    }
    self.set('Location', encodeUrl(url))
    if (!REDIRECT_STATUSES.has(self.status)) self.status = 302
    if (self.ctx.accepts('html')) {
      const escaped = escapeHtml(url)
      self.type = 'text/html; charset=utf-8'
      self.body = `Redirecting to <a href="${escaped}">${escaped}</a>.`
      return
    }
    self.type = 'text/plain; charset=utf-8'
    self.body = `Redirecting to ${url}.`
  },

  back(alt?: string) {
    const self = this as any
    const referrer = self.ctx.get('Referrer')
    if (referrer) {
      try {
        const refUrl = new URL(referrer, self.ctx.href)
        if (refUrl.host === self.ctx.host) { self.redirect(referrer); return }
      } catch { /* invalid URL, fall through */ }
    }
    self.redirect(alt || '/')
  },

  attachment(filename?: string, options?: { type?: string; fallback?: string }) {
    const self = this as any
    if (filename && !self.has('Content-Type')) self.type = extname(filename)
    self.set('Content-Disposition', formatContentDisposition(filename, options))
  },

  set type(type: string) {
    const self = this as any
    const ct = resolveContentType(type)
    if (ct) self.set('Content-Type', ct)
    else self.remove('Content-Type')
  },

  get type(): string {
    const rawType = (this as any).get('Content-Type')
    const type: string = typeof rawType === 'string' ? rawType : ''
    if (!type) return ''
    return type.split(';', 1)[0]!
  },

  set lastModified(val: string | Date) {
    const self = this as any
    if (typeof val === 'string') val = new Date(val)
    self.set('Last-Modified', (val as Date).toUTCString())
  },

  get lastModified(): Date | undefined {
    const date = (this as any).get('Last-Modified') as string
    if (date) return new Date(date)
    return undefined
  },

  set etag(val: string) {
    const self = this as any
    if (!/^(W\/)?"/.test(val)) val = `"${val}"`
    self.set('ETag', val)
  },

  get etag(): string { return (this as any).get('ETag') || '' },

  is(type: string, ...types: string[]) {
    return typeIs((this as any).type, type, ...types)
  },

  get(field: string): string | null {
    return ((this as any)._headers as Headers).get(field)
  },

  has(field: string): boolean {
    return ((this as any)._headers as Headers).has(field)
  },

  set(field: string | Record<string, unknown>, val?: unknown) {
    const self = this as any
    const headers = self._headers as Headers
    if (!field) return
    if (typeof field === 'string') {
      // Sanitize header values to prevent header injection (CRLF)
      const sanitized = String(val).replace(/[\r\n]/g, '')
      headers.set(field, sanitized)
    } else {
      for (const [k, v] of Object.entries(field)) {
        headers.set(k, String(v).replace(/[\r\n]/g, ''))
      }
    }
  },

  append(field: string, val: string | string[]) {
    const headers = (this as any)._headers as Headers
    const values = Array.isArray(val) ? val : [val]
    for (const v of values) headers.append(field, v.replace(/[\r\n]/g, ''))
  },

  remove(field: string) {
    ((this as any)._headers as Headers).delete(field)
  },

  get writable(): boolean { return true },

  toJSON() {
    const self = this as any
    return { status: self.status, message: self.message, header: self.header }
  },

  flushHeaders() { /* noop in Bun — response is built at the end */ }
}

export default response
