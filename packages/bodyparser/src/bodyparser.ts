import { parseBytes, type Middleware, type KentoContext } from '@kento/core'

export interface BodyParserOptions {
  enableTypes?: string[]
  encoding?: string
  formLimit?: string | number
  jsonLimit?: string | number
  textLimit?: string | number
  xmlLimit?: string | number
  strict?: boolean
  detectJSON?: (ctx: KentoContext) => boolean
  extendTypes?: Record<string, string | string[]>
  onerror?: (err: Error, ctx: KentoContext) => void
}

const DEFAULT_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

async function readBody(req: Request, limit: number, _encoding: string): Promise<string> {
  // Check Content-Length first to fail fast
  const cl = req.headers.get('content-length')
  if (cl && parseInt(cl, 10) > limit) {
    throw Object.assign(new Error('Request Entity Too Large'), { status: 413, expose: true })
  }
  const buffer = await req.arrayBuffer()
  if (buffer.byteLength > limit) {
    throw Object.assign(new Error('Request Entity Too Large'), { status: 413, expose: true })
  }
  return new TextDecoder().decode(buffer)
}

function getContentType(req: Request): string {
  const raw = req.headers.get('content-type') || ''
  return (raw.split(';')[0] ?? '').trim().toLowerCase()
}

function matchesTypes(ct: string, types: string[]): boolean {
  return types.some(t => {
    if (t === 'json') return ct.includes('json')
    if (t === 'form') return ct === 'application/x-www-form-urlencoded'
    if (t === 'text') return ct.startsWith('text/')
    if (t === 'xml') return ct.includes('xml')
    return ct.includes(t)
  })
}

function normalizeTypes(types: string | string[] | undefined): string[] {
  if (!types) return []
  return Array.isArray(types) ? types : [types]
}

export function bodyParser(options: BodyParserOptions = {}): Middleware {
  const opts = {
    enableTypes: ['json', 'form'],
    encoding: 'utf-8',
    jsonLimit: '1mb',
    formLimit: '1mb',
    textLimit: '1mb',
    xmlLimit: '1mb',
    strict: true,
    ...options
  }

  const jsonLimit = parseBytes(opts.jsonLimit)
  const formLimit = parseBytes(opts.formLimit)
  const textLimit = parseBytes(opts.textLimit)
  const xmlLimit = parseBytes(opts.xmlLimit)

  return async function bodyParserMiddleware(ctx, next) {
    if (!DEFAULT_METHODS.includes(ctx.method?.toUpperCase() ?? '')) return next()

    // Check if body was already parsed
    if ((ctx as any).request.body !== undefined) return next()

    const req = (ctx as any).req as Request
    const ct = opts.detectJSON
      ? (opts.detectJSON(ctx as any) ? 'application/json' : getContentType(req))
      : getContentType(req)

    const ext = opts.extendTypes ?? {}
    const jsonTypes = ['json', ...normalizeTypes(ext.json)]
    const formTypes = ['form', ...normalizeTypes(ext.form)]
    const textTypes = ['text', ...normalizeTypes(ext.text)]
    const xmlTypes = ['xml', ...normalizeTypes(ext.xml)]

    const enableTypes = opts.enableTypes

    try {
      if (enableTypes.includes('json') && matchesTypes(ct, jsonTypes)) {
        const raw = await readBody(req, jsonLimit, opts.encoding)
        ;(ctx as any).request.rawBody = raw
        if (opts.strict && raw) {
          // In strict mode, only accept arrays and objects at top level
          const firstChar = raw.trim()[0]
          if (firstChar !== '{' && firstChar !== '[') {
            throw Object.assign(new Error('invalid JSON, only supports object and array'), {
              status: 400, expose: true
            })
          }
        }
        ;(ctx as any).request.body = raw ? JSON.parse(raw) : undefined
      } else if (enableTypes.includes('form') && matchesTypes(ct, formTypes)) {
        const raw = await readBody(req, formLimit, opts.encoding)
        ;(ctx as any).request.rawBody = raw
        ;(ctx as any).request.body = Object.fromEntries(new URLSearchParams(raw))
      } else if (enableTypes.includes('text') && matchesTypes(ct, textTypes)) {
        const raw = await readBody(req, textLimit, opts.encoding)
        ;(ctx as any).request.rawBody = raw
        ;(ctx as any).request.body = raw
      } else if (enableTypes.includes('xml') && matchesTypes(ct, xmlTypes)) {
        const raw = await readBody(req, xmlLimit, opts.encoding)
        ;(ctx as any).request.rawBody = raw
        ;(ctx as any).request.body = raw
      }
    } catch (err) {
      if (opts.onerror) opts.onerror(err as Error, ctx as any)
      else throw err
    }

    return next()
  }
}

export default bodyParser
