import type { Middleware } from '@kento/core'
import { parseBytes, isCompressible, acceptsEncodings } from '@kento/core/src/utils'

export interface CompressOptions {
  filter?: (contentType: string) => boolean
  threshold?: string | number
  br?: boolean
  gzip?: boolean
  deflate?: boolean
}

const DEFAULT_THRESHOLD = 1024

function getBodyBytes(body: unknown): Uint8Array | null {
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return body
  if (Buffer.isBuffer(body)) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  return null
}

function normalizeBytes(bytes: Uint8Array): Uint8Array<ArrayBufferLike> {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function compress(options: CompressOptions = {}): Middleware {
  const filter = options.filter ?? isCompressible
  const threshold = parseBytes(options.threshold ?? DEFAULT_THRESHOLD)
  const gzipEnabled = options.gzip !== false
  const deflateEnabled = options.deflate !== false

  return async function compressMiddleware(ctx, next) {
    await next()

    const body = (ctx as any).body
    if (!body) return
    if ((ctx as any).compress === false) return
    if (ctx.method === 'HEAD') return
    if (ctx.status === 204 || ctx.status === 304) return

    const cacheControl = (ctx as any).response.get('Cache-Control') as string
    if (cacheControl && /no-transform/i.test(cacheControl)) return

    const contentType = (ctx as any).response.type
    if (!contentType || !filter(contentType)) return

    // Check size threshold
    const bytes = getBodyBytes(body)
    if (bytes && bytes.length < threshold && !(ctx as any).compress) return

    // Content negotiation for encoding
    const acceptEncoding = (ctx as any).request.get('Accept-Encoding')
    const available: string[] = []
    if (gzipEnabled) available.push('gzip')
    if (deflateEnabled) available.push('deflate')
    available.push('identity')

    const encoding = acceptsEncodings(acceptEncoding, ...available)
    if (!encoding || encoding === 'identity') return

    ctx.vary('Accept-Encoding')

    // Use Bun's native compression for buffer/string bodies
    if (bytes) {
      let compressed: Uint8Array<ArrayBuffer>
      switch (encoding) {
        case 'gzip':
          compressed = Bun.gzipSync(normalizeBytes(bytes) as Uint8Array<ArrayBuffer>)
          break
        case 'deflate':
          compressed = Bun.deflateSync(normalizeBytes(bytes) as Uint8Array<ArrayBuffer>)
          break
        default:
          return
      }
      ctx.set('Content-Encoding', encoding as string)
      ctx.remove('Content-Length')
      ;(ctx as any).body = Buffer.from(compressed)
      ctx.set('Content-Length', String(compressed.length))
      return
    }

    // For streaming/blob bodies, use web CompressionStream
    if (body instanceof ReadableStream || body instanceof Blob) {
      const sourceStream = body instanceof Blob ? body.stream() : body
      const compressed = sourceStream.pipeThrough(new CompressionStream(encoding as 'gzip' | 'deflate'))
      ctx.set('Content-Encoding', encoding as string)
      ctx.remove('Content-Length')
      ;(ctx as any).body = compressed
      return
    }

    // JSON body — serialize first then compress
    if (typeof body === 'object') {
      const jsonBytes = new TextEncoder().encode(JSON.stringify(body))
      if (jsonBytes.length < threshold) return

      let compressed: Uint8Array
      switch (encoding) {
        case 'gzip':
          compressed = Bun.gzipSync(jsonBytes)
          break
        case 'deflate':
          compressed = Bun.deflateSync(jsonBytes)
          break
        default:
          return
      }
      ctx.set('Content-Encoding', encoding as string)
      ctx.remove('Content-Length')
      ;(ctx as any).body = Buffer.from(compressed)
      ctx.set('Content-Length', String(compressed.length))
    }
  }
}

export default compress
