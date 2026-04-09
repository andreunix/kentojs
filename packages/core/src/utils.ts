// ─── HTTP Status Codes ───────────────────────────────────────────────────────

export const STATUS_CODES: Record<number, string> = {
  100: 'Continue', 101: 'Switching Protocols', 102: 'Processing', 103: 'Early Hints',
  200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information',
  204: 'No Content', 205: 'Reset Content', 206: 'Partial Content', 207: 'Multi-Status',
  208: 'Already Reported', 226: 'IM Used',
  300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other',
  304: 'Not Modified', 305: 'Use Proxy', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden',
  404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable',
  407: 'Proxy Authentication Required', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone',
  411: 'Length Required', 412: 'Precondition Failed', 413: 'Payload Too Large',
  414: 'URI Too Long', 415: 'Unsupported Media Type', 416: 'Range Not Satisfiable',
  417: 'Expectation Failed', 418: "I'm a Teapot", 421: 'Misdirected Request',
  422: 'Unprocessable Entity', 423: 'Locked', 424: 'Failed Dependency',
  425: 'Too Early', 426: 'Upgrade Required', 428: 'Precondition Required',
  429: 'Too Many Requests', 431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates', 507: 'Insufficient Storage', 508: 'Loop Detected',
  510: 'Not Extended', 511: 'Network Authentication Required'
}

export const EMPTY_STATUSES = new Set([204, 205, 304])
export const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 305, 307, 308])

// ─── HttpError ───────────────────────────────────────────────────────────────

export class HttpError extends Error {
  status: number
  statusCode: number
  expose: boolean
  headers?: Record<string, string>

  constructor(status: number = 500, message?: string, properties?: Record<string, unknown>) {
    super(message || STATUS_CODES[status] || 'Error')
    this.status = status
    this.statusCode = status
    this.expose = status < 500
    this.name = 'HttpError'
    if (properties) {
      // Guard against prototype pollution — only allow safe property keys
      for (const [key, val] of Object.entries(properties)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        ;(this as any)[key] = val
      }
    }
  }
}

export function createHttpError(...args: unknown[]): HttpError {
  if (args.length === 0) return new HttpError(500)

  const first = args[0]
  if (first instanceof Error) {
    const err = first as Error & { status?: number; statusCode?: number }
    const status = err.status || err.statusCode || 500
    const httpErr = new HttpError(status, err.message)
    httpErr.stack = err.stack
    return httpErr
  }
  if (typeof first === 'number') {
    return new HttpError(first, args[1] as string | undefined, args[2] as Record<string, unknown> | undefined)
  }
  if (typeof first === 'string') {
    return new HttpError(500, first)
  }
  return new HttpError(500)
}

// ─── HTTP Freshness (replaces `fresh`) ───────────────────────────────────────

export function isFresh(
  reqHeaders: Record<string, string | undefined>,
  resHeaders: Record<string, string | undefined>
): boolean {
  const noneMatch = reqHeaders['if-none-match']
  const modifiedSince = reqHeaders['if-modified-since']

  if (!noneMatch && !modifiedSince) return false

  const cacheControl = reqHeaders['cache-control']
  if (cacheControl && /(?:^|,)\s*no-cache\s*(?:,|$)/.test(cacheControl)) return false

  if (noneMatch && noneMatch !== '*') {
    const etag = resHeaders['etag']
    if (!etag) return false

    let etagStale = true
    const tags = parseTokenList(noneMatch)
    for (const tag of tags) {
      if (tag === etag || tag === `W/${etag}` || `W/${tag}` === etag) {
        etagStale = false
        break
      }
      // Weak comparison: strip W/ prefix from both
      const t1 = tag.startsWith('W/') ? tag.slice(2) : tag
      const t2 = etag.startsWith('W/') ? etag.slice(2) : etag
      if (t1 === t2) { etagStale = false; break }
    }
    if (etagStale) return false
  }

  if (modifiedSince) {
    const lastModified = resHeaders['last-modified']
    if (!lastModified) return false
    const modDate = Date.parse(modifiedSince)
    const lastDate = Date.parse(lastModified)
    if (isNaN(modDate) || isNaN(lastDate)) return false
    if (lastDate > modDate) return false
  }

  return true
}

function parseTokenList(header: string): string[] {
  const tokens: string[] = []
  let start = 0
  let end = 0

  for (let i = 0; i < header.length; i++) {
    switch (header.charCodeAt(i)) {
      case 0x20: // space
        if (start === end) start = end = i + 1
        break
      case 0x2c: // comma
        if (start !== end) tokens.push(header.substring(start, end))
        start = end = i + 1
        break
      default:
        end = i + 1
        break
    }
  }
  if (start !== end) tokens.push(header.substring(start, end))
  return tokens
}

// ─── Escape HTML (replaces `escape-html`) ────────────────────────────────────

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}

export function escapeHtml(str: string): string {
  if (!str) return str
  return str.replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch]!)
}

// ─── Encode URL (replaces `encodeurl`) ───────────────────────────────────────

const ENCODE_CHARS_REGEXP = /(?:[^\x21\x25\x26-\x3B\x3D\x3F-\x5B\x5D\x5F\x61-\x7A\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))/g

export function encodeUrl(url: string): string {
  return url.replace(ENCODE_CHARS_REGEXP, encodeURIComponent)
}

// ─── Vary Header (replaces `vary`) ───────────────────────────────────────────

export function varyAppend(existing: string, field: string): string {
  if (existing === '*' || field === '*') return '*'

  const current = existing ? existing.split(',').map(s => s.trim()) : []
  const currentLower = new Set(current.map(s => s.toLowerCase()))
  const fields = field.split(',').map(s => s.trim())

  for (const f of fields) {
    if (f && !currentLower.has(f.toLowerCase())) {
      current.push(f)
      currentLower.add(f.toLowerCase())
    }
  }

  return current.join(', ')
}

export function varyHeader(headers: Headers, field: string): void {
  const current = headers.get('Vary') || ''
  const updated = varyAppend(current, field)
  if (updated) headers.set('Vary', updated)
}

// ─── Content Negotiation (replaces `accepts`) ────────────────────────────────

interface QualityItem {
  value: string
  q: number
  index: number
}

function parseQualityHeader(header: string): QualityItem[] {
  if (!header) return []
  return header.split(',').map((part, index) => {
    const segments = part.trim().split(';')
    const value = (segments[0] ?? '').trim()
    let q = 1
    for (let i = 1; i < segments.length; i++) {
      const param = segments[i]!.trim()
      if (param.startsWith('q=')) {
        q = Math.max(0, Math.min(1, parseFloat(param.slice(2)) || 0))
      }
    }
    return { value, q, index }
  }).filter(r => r.q > 0).sort((a, b) => b.q - a.q || a.index - b.index)
}

export function acceptsTypes(acceptHeader: string, ...types: string[]): string | false | string[] {
  const items = parseQualityHeader(acceptHeader || '*/*')
  if (types.length === 0) return items.map(i => i.value)

  for (const item of items) {
    const [aType = '*', aSub = '*'] = item.value.split('/')
    for (const type of types) {
      const full = type.includes('/') ? type : mimeForExt(type)
      if (!full) continue
      const [bType = '', bSub = ''] = full.split('/')
      if ((aType === '*' || aType === bType) && (aSub === '*' || aSub === bSub)) {
        return type
      }
      // Handle +suffix: application/vnd.api+json matches application/*+json
      if (aType === bType && aSub.startsWith('*+')) {
        const suffix = aSub.slice(1)
        if (bSub.endsWith(suffix)) return type
      }
    }
  }
  return false
}

export function acceptsEncodings(acceptHeader: string, ...encodings: string[]): string | false | string[] {
  const items = parseQualityHeader(acceptHeader || 'identity')
  if (encodings.length === 0) return items.map(i => i.value)
  // Add identity as implicit default if not rejected
  const hasIdentity = items.some(i => i.value === 'identity')
  const identityRejected = items.some(i => i.value === 'identity' && i.q === 0)
  if (!hasIdentity && !identityRejected) items.push({ value: 'identity', q: 0.001, index: items.length })

  for (const item of items) {
    if (item.value === '*') {
      // Return first available
      for (const enc of encodings) {
        const rejected = items.some(i => i.value === enc && i.q === 0)
        if (!rejected) return enc
      }
    }
    if (encodings.includes(item.value)) return item.value
  }
  return false
}

export function acceptsCharsets(acceptHeader: string, ...charsets: string[]): string | false | string[] {
  const items = parseQualityHeader(acceptHeader || '*')
  if (charsets.length === 0) return items.map(i => i.value)
  for (const item of items) {
    if (item.value === '*') return charsets[0] ?? false
    const lower = item.value.toLowerCase()
    for (const cs of charsets) {
      if (cs.toLowerCase() === lower) return cs
    }
  }
  return false
}

export function acceptsLanguages(acceptHeader: string, ...languages: string[]): string | false | string[] {
  const items = parseQualityHeader(acceptHeader || '*')
  if (languages.length === 0) return items.map(i => i.value)
  for (const item of items) {
    if (item.value === '*') return languages[0] ?? false
    const lower = item.value.toLowerCase()
    for (const lang of languages) {
      if (lang.toLowerCase() === lower || lang.toLowerCase().startsWith(lower + '-')) return lang
    }
  }
  return false
}

// ─── Type-Is (replaces `type-is`) ────────────────────────────────────────────

export function typeIs(contentType: string | null | undefined, ...types: string[]): string | false | null {
  if (!contentType) return null

  const ct = contentType.split(';')[0]!.trim().toLowerCase()
  if (!ct) return null

  if (types.length === 0) return ct

  for (const type of types) {
    if (matchType(ct, type)) return type
  }
  return false
}

function matchType(actual: string, expected: string): boolean {
  // Normalize shorthand names
  let normalized = expected
  if (expected === 'urlencoded') normalized = 'application/x-www-form-urlencoded'
  else if (expected === 'multipart') normalized = 'multipart/*'
  else if (expected === 'json') normalized = 'application/json'
  else if (expected === 'text') return actual.startsWith('text/')
  else if (expected === 'html') normalized = 'text/html'
  else if (expected === 'xml') return actual.includes('xml')
  else if (expected.startsWith('+')) return actual.endsWith(expected)
  else if (!expected.includes('/')) {
    const m = mimeForExt(expected)
    if (m) normalized = m
    else return actual.includes(expected)
  }

  if (normalized === actual) return true

  const [eType = '', eSub = ''] = normalized.split('/')
  const [aType = '', aSub = ''] = actual.split('/')

  if (eType === '*' || eType === aType) {
    if (eSub === '*') return true
    if (eSub === aSub) return true
    if (eSub.startsWith('*+')) {
      return aSub.endsWith(eSub.slice(1))
    }
  }
  return false
}

// ─── MIME Types (replaces `mime-types`) ──────────────────────────────────────

const MIME_DB: Record<string, string> = {
  html: 'text/html', htm: 'text/html', txt: 'text/plain', text: 'text/plain',
  css: 'text/css', csv: 'text/csv', xml: 'text/xml', svg: 'image/svg+xml',
  js: 'application/javascript', mjs: 'application/javascript',
  json: 'application/json', jsonld: 'application/ld+json',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip',
  tar: 'application/x-tar', rar: 'application/vnd.rar',
  wasm: 'application/wasm', bin: 'application/octet-stream',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo', mov: 'video/quicktime',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  yaml: 'application/x-yaml', yml: 'application/x-yaml',
  ts: 'video/mp2t', tsx: 'video/mp2t',
  md: 'text/markdown', markdown: 'text/markdown',
  map: 'application/json', webmanifest: 'application/manifest+json',
  form: 'application/x-www-form-urlencoded'
}

const TEXT_TYPES = new Set([
  'text/', 'application/json', 'application/javascript', 'application/xml',
  'application/x-yaml', 'application/ld+json', 'application/manifest+json',
  'image/svg+xml', 'text/markdown'
])

function needsCharset(mime: string): boolean {
  if (mime.startsWith('text/')) return true
  return TEXT_TYPES.has(mime)
}

export function mimeForExt(ext: string): string | false {
  const clean = ext.startsWith('.') ? ext.slice(1) : ext
  return MIME_DB[clean.toLowerCase()] || false
}

export function contentType(type: string): string | false {
  if (type.includes('/')) {
    // Already a MIME type, add charset if needed
    if (needsCharset(type) && !type.includes('charset')) {
      return `${type}; charset=utf-8`
    }
    return type
  }

  const ext = type.startsWith('.') ? type.slice(1) : type
  const mime = MIME_DB[ext.toLowerCase()]
  if (!mime) return false
  if (needsCharset(mime)) return `${mime}; charset=utf-8`
  return mime
}

export function extensionForMime(mime: string): string | false {
  const base = mime.split(';')[0]!.trim().toLowerCase()
  for (const [ext, m] of Object.entries(MIME_DB)) {
    if (m === base) return ext
  }
  return false
}

// ─── Content-Disposition (replaces `content-disposition`) ────────────────────

export function formatContentDisposition(filename?: string, options?: { type?: string; fallback?: string }): string {
  const type = options?.type || 'attachment'
  if (!filename) return type

  // Sanitize filename to prevent header injection
  const sanitized = filename.replace(/[\x00-\x1f\x7f"\\]/g, '')

  // Check if filename is ASCII-only
  const isAscii = /^[\x20-\x7e]*$/.test(sanitized)

  if (isAscii) {
    return `${type}; filename="${sanitized}"`
  }

  const fallback = options?.fallback ?? sanitized.replace(/[^\x20-\x7e]/g, '?')
  const encoded = encodeURIComponent(sanitized).replace(/['()]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

// ─── Cookie Parsing (replaces `cookies`) ─────────────────────────────────────

export function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies

  const pairs = header.split(';')
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) continue
    const key = pair.slice(0, eqIdx).trim()
    let val = pair.slice(eqIdx + 1).trim()
    // Remove surrounding quotes if present
    if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
      val = val.slice(1, -1)
    }
    // Only set if key is valid (no special chars)
    if (key && !cookies[key]) {
      try {
        cookies[key] = decodeURIComponent(val)
      } catch {
        cookies[key] = val
      }
    }
  }
  return cookies
}

export interface CookieOptions {
  maxAge?: number
  domain?: string
  path?: string
  expires?: Date
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  signed?: boolean
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  // Validate cookie name (RFC 6265)
  if (/[=,; \t\r\n\x00-\x1f\x7f]/.test(name)) {
    throw new TypeError(`Invalid cookie name: ${name}`)
  }

  const encodedValue = encodeURIComponent(value)
  let cookie = `${name}=${encodedValue}`

  if (options.maxAge != null) {
    const maxAge = Math.floor(options.maxAge)
    cookie += `; Max-Age=${maxAge}`
  }
  if (options.domain) cookie += `; Domain=${options.domain}`
  cookie += `; Path=${options.path || '/'}`
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`
  if (options.httpOnly !== false) cookie += '; HttpOnly'
  if (options.secure) cookie += '; Secure'
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`

  return cookie
}

// ─── HMAC Signing for Cookies ────────────────────────────────────────────────

export async function signValue(val: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(val))
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=+$/, '')
  return `${val}.${base64}`
}

export async function unsignValue(signed: string, secret: string): Promise<string | false> {
  const lastDot = signed.lastIndexOf('.')
  if (lastDot === -1) return false

  const val = signed.slice(0, lastDot)
  const expected = await signValue(val, secret)

  if (expected.length !== signed.length) return false

  // Constant-time comparison
  const a = new TextEncoder().encode(expected)
  const b = new TextEncoder().encode(signed)
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!
  return result === 0 ? val : false
}

// ─── Compressible Content-Type Check (replaces `compressible`) ───────────────

const COMPRESSIBLE_TYPES = new Set([
  'text/html', 'text/css', 'text/plain', 'text/xml', 'text/csv',
  'text/javascript', 'text/markdown',
  'application/json', 'application/javascript', 'application/xml',
  'application/x-yaml', 'application/ld+json', 'application/manifest+json',
  'application/wasm', 'application/x-www-form-urlencoded',
  'image/svg+xml'
])

export function isCompressible(contentType: string): boolean {
  const base = contentType.split(';')[0]!.trim().toLowerCase()
  if (COMPRESSIBLE_TYPES.has(base)) return true
  // Anything with +json or +xml suffix is compressible
  if (base.endsWith('+json') || base.endsWith('+xml')) return true
  // text/* is generally compressible
  if (base.startsWith('text/')) return true
  return false
}

// ─── Bytes Parsing ───────────────────────────────────────────────────────────

const BYTE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }

export function parseBytes(limit: string | number): number {
  if (typeof limit === 'number') return limit
  const match = limit.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/)
  if (!match) return 1024 * 1024
  return Math.floor(parseFloat(match[1]!) * (BYTE_UNITS[match[2] ?? 'b'] ?? 1))
}

// ─── Duration Formatting (replaces `ms`) ─────────────────────────────────────

export function formatMs(ms: number, long?: boolean): string {
  const abs = Math.abs(ms)
  if (long) {
    if (abs >= 86400000) return `${Math.round(ms / 86400000)} day${Math.round(ms / 86400000) !== 1 ? 's' : ''}`
    if (abs >= 3600000) return `${Math.round(ms / 3600000)} hour${Math.round(ms / 3600000) !== 1 ? 's' : ''}`
    if (abs >= 60000) return `${Math.round(ms / 60000)} minute${Math.round(ms / 60000) !== 1 ? 's' : ''}`
    if (abs >= 1000) return `${Math.round(ms / 1000)} second${Math.round(ms / 1000) !== 1 ? 's' : ''}`
    return `${ms} ms`
  }
  if (abs >= 86400000) return `${Math.round(ms / 86400000)}d`
  if (abs >= 3600000) return `${Math.round(ms / 3600000)}h`
  if (abs >= 60000) return `${Math.round(ms / 60000)}m`
  if (abs >= 1000) return `${Math.round(ms / 1000)}s`
  return `${ms}ms`
}
