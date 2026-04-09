import { describe, it, expect } from 'bun:test'
import {
  STATUS_CODES, EMPTY_STATUSES, REDIRECT_STATUSES,
  HttpError, createHttpError,
  isFresh, escapeHtml, encodeUrl,
  varyAppend, varyHeader,
  acceptsTypes, acceptsEncodings, acceptsCharsets, acceptsLanguages,
  typeIs, mimeForExt, contentType,
  formatContentDisposition, parseCookies, serializeCookie,
  signValue, unsignValue,
  isCompressible, parseBytes, formatMs
} from '../src/utils'

// ─── STATUS_CODES ────────────────────────────────────────────────────────────

describe('STATUS_CODES', () => {
  it('should have standard codes', () => {
    expect(STATUS_CODES[200]).toBe('OK')
    expect(STATUS_CODES[404]).toBe('Not Found')
    expect(STATUS_CODES[500]).toBe('Internal Server Error')
  })

  it('should identify empty statuses', () => {
    expect(EMPTY_STATUSES.has(204)).toBe(true)
    expect(EMPTY_STATUSES.has(304)).toBe(true)
    expect(EMPTY_STATUSES.has(200)).toBe(false)
  })

  it('should identify redirect statuses', () => {
    expect(REDIRECT_STATUSES.has(301)).toBe(true)
    expect(REDIRECT_STATUSES.has(302)).toBe(true)
    expect(REDIRECT_STATUSES.has(200)).toBe(false)
  })
})

// ─── HttpError ───────────────────────────────────────────────────────────────

describe('HttpError', () => {
  it('should create with status and message', () => {
    const err = new HttpError(404, 'Not Found')
    expect(err.status).toBe(404)
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('Not Found')
    expect(err.expose).toBe(true)
  })

  it('should not expose 5xx errors', () => {
    const err = new HttpError(500)
    expect(err.expose).toBe(false)
    expect(err.message).toBe('Internal Server Error')
  })

  it('should be an instance of Error', () => {
    const err = new HttpError(400)
    expect(err instanceof Error).toBe(true)
    expect(err instanceof HttpError).toBe(true)
  })
})

describe('createHttpError', () => {
  it('should create from status number', () => {
    const err = createHttpError(404, 'custom message')
    expect(err.status).toBe(404)
    expect(err.message).toBe('custom message')
  })

  it('should create from Error', () => {
    const original = new Error('original')
    const err = createHttpError(original)
    expect(err.status).toBe(500)
    expect(err.message).toBe('original')
  })

  it('should create from string', () => {
    const err = createHttpError('something went wrong')
    expect(err.status).toBe(500)
    expect(err.message).toBe('something went wrong')
  })
})

// ─── isFresh ─────────────────────────────────────────────────────────────────

describe('isFresh', () => {
  it('should return false when no conditional headers', () => {
    expect(isFresh({}, {})).toBe(false)
  })

  it('should return true when etags match', () => {
    expect(isFresh(
      { 'if-none-match': '"abc"' },
      { 'etag': '"abc"' }
    )).toBe(true)
  })

  it('should return false when etags dont match', () => {
    expect(isFresh(
      { 'if-none-match': '"abc"' },
      { 'etag': '"def"' }
    )).toBe(false)
  })

  it('should handle weak etags', () => {
    expect(isFresh(
      { 'if-none-match': 'W/"abc"' },
      { 'etag': '"abc"' }
    )).toBe(true)
  })

  it('should check If-Modified-Since', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    const before = new Date('2023-01-01T00:00:00Z')
    expect(isFresh(
      { 'if-modified-since': now.toUTCString() },
      { 'last-modified': before.toUTCString() }
    )).toBe(true)
  })

  it('should return false when no-cache', () => {
    expect(isFresh(
      { 'if-none-match': '"abc"', 'cache-control': 'no-cache' },
      { 'etag': '"abc"' }
    )).toBe(false)
  })
})

// ─── escapeHtml ──────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('should escape special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    )
  })

  it('should escape ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar')
  })

  it('should escape single quotes', () => {
    expect(escapeHtml("it's")).toBe("it&#39;s")
  })

  it('should return empty string unchanged', () => {
    expect(escapeHtml('')).toBe('')
  })
})

// ─── encodeUrl ───────────────────────────────────────────────────────────────

describe('encodeUrl', () => {
  it('should encode spaces and special chars', () => {
    const encoded = encodeUrl('/path with spaces')
    expect(encoded).toContain('%20')
  })

  it('should not double-encode', () => {
    const encoded = encodeUrl('/path%20already')
    expect(encoded).toBe('/path%20already')
  })
})

// ─── varyAppend ──────────────────────────────────────────────────────────────

describe('varyAppend', () => {
  it('should append new field', () => {
    expect(varyAppend('', 'Origin')).toBe('Origin')
  })

  it('should append to existing', () => {
    expect(varyAppend('Accept', 'Origin')).toBe('Accept, Origin')
  })

  it('should not duplicate', () => {
    expect(varyAppend('Origin', 'Origin')).toBe('Origin')
  })

  it('should handle case insensitive', () => {
    expect(varyAppend('origin', 'Origin')).toBe('origin')
  })

  it('should return * for wildcard', () => {
    expect(varyAppend('anything', '*')).toBe('*')
    expect(varyAppend('*', 'Origin')).toBe('*')
  })
})

// ─── Content Negotiation ─────────────────────────────────────────────────────

describe('acceptsTypes', () => {
  it('should return matching type', () => {
    expect(acceptsTypes('text/html, application/json', 'json', 'html')).toBe('html')
  })

  it('should respect quality values', () => {
    expect(acceptsTypes('text/html;q=0.9, application/json', 'json', 'html')).toBe('json')
  })

  it('should return false when no match', () => {
    expect(acceptsTypes('text/html', 'json')).toBe(false)
  })

  it('should handle wildcard accept', () => {
    expect(acceptsTypes('*/*', 'json')).toBe('json')
  })

  it('should return all types when no args', () => {
    const result = acceptsTypes('text/html, application/json')
    expect(Array.isArray(result)).toBe(true)
  })
})

describe('acceptsEncodings', () => {
  it('should return matching encoding', () => {
    expect(acceptsEncodings('gzip, deflate', 'gzip', 'identity')).toBe('gzip')
  })

  it('should fall back to identity', () => {
    expect(acceptsEncodings('', 'gzip', 'identity')).toBe('identity')
  })
})

describe('acceptsCharsets', () => {
  it('should return matching charset', () => {
    expect(acceptsCharsets('utf-8, iso-8859-1', 'utf-8')).toBe('utf-8')
  })
})

describe('acceptsLanguages', () => {
  it('should return matching language', () => {
    expect(acceptsLanguages('en-US, pt-BR', 'pt-BR', 'en-US')).toBe('en-US')
  })
})

// ─── typeIs ──────────────────────────────────────────────────────────────────

describe('typeIs', () => {
  it('should return null when no content type', () => {
    expect(typeIs(null)).toBe(null)
    expect(typeIs('')).toBe(null)
  })

  it('should return type when matching', () => {
    expect(typeIs('application/json', 'json')).toBe('json')
  })

  it('should return false when not matching', () => {
    expect(typeIs('text/html', 'json')).toBe(false)
  })

  it('should handle full mime types', () => {
    expect(typeIs('application/json; charset=utf-8', 'application/json')).toBe('application/json')
  })

  it('should handle wildcards', () => {
    expect(typeIs('text/html', 'text/*')).toBe('text/*')
  })

  it('should handle urlencoded shorthand', () => {
    expect(typeIs('application/x-www-form-urlencoded', 'urlencoded')).toBe('urlencoded')
  })
})

// ─── MIME Types ──────────────────────────────────────────────────────────────

describe('mimeForExt', () => {
  it('should return mime type for known extensions', () => {
    expect(mimeForExt('html')).toBe('text/html')
    expect(mimeForExt('json')).toBe('application/json')
    expect(mimeForExt('.css')).toBe('text/css')
  })

  it('should return false for unknown extensions', () => {
    expect(mimeForExt('unknown123')).toBe(false)
  })
})

describe('contentType', () => {
  it('should add charset for text types', () => {
    expect(contentType('html')).toBe('text/html; charset=utf-8')
    expect(contentType('json')).toBe('application/json; charset=utf-8')
  })

  it('should not add charset for binary types', () => {
    expect(contentType('png')).toBe('image/png')
  })

  it('should handle full mime types', () => {
    expect(contentType('text/html')).toBe('text/html; charset=utf-8')
  })

  it('should return false for unknown types', () => {
    expect(contentType('xxxunknown')).toBe(false)
  })
})

// ─── Content-Disposition ─────────────────────────────────────────────────────

describe('formatContentDisposition', () => {
  it('should return attachment without filename', () => {
    expect(formatContentDisposition()).toBe('attachment')
  })

  it('should include filename', () => {
    expect(formatContentDisposition('file.pdf')).toBe('attachment; filename="file.pdf"')
  })

  it('should handle unicode filenames', () => {
    const result = formatContentDisposition('café.pdf')
    expect(result).toContain('filename*=UTF-8')
  })

  it('should sanitize control characters', () => {
    const result = formatContentDisposition('test\x00file.txt')
    expect(result).not.toContain('\x00')
  })
})

// ─── Cookie Parsing ──────────────────────────────────────────────────────────

describe('parseCookies', () => {
  it('should parse simple cookies', () => {
    expect(parseCookies('foo=bar; baz=qux')).toEqual({ foo: 'bar', baz: 'qux' })
  })

  it('should handle empty string', () => {
    expect(parseCookies('')).toEqual({})
  })

  it('should decode URI components', () => {
    expect(parseCookies('name=%E4%B8%AD%E6%96%87')).toEqual({ name: '中文' })
  })

  it('should handle quoted values', () => {
    expect(parseCookies('foo="bar baz"')).toEqual({ foo: 'bar baz' })
  })
})

describe('serializeCookie', () => {
  it('should serialize basic cookie', () => {
    const result = serializeCookie('name', 'value')
    expect(result).toContain('name=value')
    expect(result).toContain('Path=/')
    expect(result).toContain('HttpOnly')
  })

  it('should include Max-Age', () => {
    const result = serializeCookie('name', 'value', { maxAge: 3600 })
    expect(result).toContain('Max-Age=3600')
  })

  it('should include Secure flag', () => {
    const result = serializeCookie('name', 'value', { secure: true })
    expect(result).toContain('Secure')
  })

  it('should include SameSite', () => {
    const result = serializeCookie('name', 'value', { sameSite: 'Strict' })
    expect(result).toContain('SameSite=Strict')
  })

  it('should reject invalid cookie names', () => {
    expect(() => serializeCookie('invalid name', 'value')).toThrow()
    expect(() => serializeCookie('invalid=name', 'value')).toThrow()
  })
})

// ─── Cookie Signing ──────────────────────────────────────────────────────────

describe('signValue / unsignValue', () => {
  it('should sign and verify correctly', async () => {
    const signed = await signValue('hello', 'secret')
    expect(signed).toContain('hello.')
    const result = await unsignValue(signed, 'secret')
    expect(result).toBe('hello')
  })

  it('should reject tampered values', async () => {
    const signed = await signValue('hello', 'secret')
    const tampered = signed.slice(0, -1) + 'x'
    const result = await unsignValue(tampered, 'secret')
    expect(result).toBe(false)
  })

  it('should reject different secret', async () => {
    const signed = await signValue('hello', 'secret1')
    const result = await unsignValue(signed, 'secret2')
    expect(result).toBe(false)
  })
})

// ─── isCompressible ──────────────────────────────────────────────────────────

describe('isCompressible', () => {
  it('should return true for text types', () => {
    expect(isCompressible('text/html')).toBe(true)
    expect(isCompressible('text/plain')).toBe(true)
    expect(isCompressible('text/css')).toBe(true)
  })

  it('should return true for json', () => {
    expect(isCompressible('application/json')).toBe(true)
  })

  it('should return true for +json suffix', () => {
    expect(isCompressible('application/vnd.api+json')).toBe(true)
  })

  it('should return false for images', () => {
    expect(isCompressible('image/png')).toBe(false)
    expect(isCompressible('image/jpeg')).toBe(false)
  })
})

// ─── parseBytes ──────────────────────────────────────────────────────────────

describe('parseBytes', () => {
  it('should parse number directly', () => {
    expect(parseBytes(1024)).toBe(1024)
  })

  it('should parse string with unit', () => {
    expect(parseBytes('1kb')).toBe(1024)
    expect(parseBytes('1mb')).toBe(1048576)
    expect(parseBytes('2gb')).toBe(2147483648)
  })

  it('should default to 1mb for invalid', () => {
    expect(parseBytes('invalid')).toBe(1048576)
  })
})

// ─── formatMs ────────────────────────────────────────────────────────────────

describe('formatMs', () => {
  it('should format short', () => {
    expect(formatMs(500)).toBe('500ms')
    expect(formatMs(1500)).toBe('2s')
    expect(formatMs(90000)).toBe('2m')
    expect(formatMs(7200000)).toBe('2h')
  })

  it('should format long', () => {
    expect(formatMs(1500, true)).toBe('2 seconds')
    expect(formatMs(90000, true)).toBe('2 minutes')
    expect(formatMs(7200000, true)).toBe('2 hours')
    expect(formatMs(172800000, true)).toBe('2 days')
  })
})
