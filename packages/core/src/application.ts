import { EventEmitter } from 'node:events'
import { compose } from './compose.ts'
import context from './context.ts'
import request from './request.ts'
import response from './response.ts'
import { STATUS_CODES, EMPTY_STATUSES, HttpError } from './utils.ts'
import type {
  Middleware,
  KentoOptions,
  ParameterizedContext,
  DefaultState,
  DefaultContext,
  KentoPlatform,
  Runtime,
  ServerHandle,
  ListenOptions,
} from './types.ts'

type LegacyRuntimeLike = {
  requestIP?: (req: Request) => { address?: string } | undefined
}

function normalizePlatform(req: Request, platform?: KentoPlatform | LegacyRuntimeLike): KentoPlatform {
  if (!platform) return {}

  const normalized = { ...(platform as Record<string, unknown>) } as KentoPlatform
  const legacy = platform as LegacyRuntimeLike

  if (!normalized.clientAddress && typeof legacy.requestIP === 'function') {
    normalized.clientAddress = legacy.requestIP(req)?.address ?? ''
  }

  return normalized
}

export class Application<
  S extends DefaultState = DefaultState,
  C extends DefaultContext = DefaultContext
> extends EventEmitter {
  proxy: boolean
  subdomainOffset: number
  proxyIpHeader: string
  maxIpsCount: number
  env: string
  silent: boolean
  keys?: string[]
  middleware: Middleware<S, C>[]
  context: Record<string, unknown>
  request: Record<string, unknown>
  response: Record<string, unknown>

  static HttpError = HttpError

  static _runtimeRegistry?: (
    runtime: Runtime,
    app: Application,
    options: ListenOptions
  ) => Promise<ServerHandle>

  async listen(options: ListenOptions = {}): Promise<ServerHandle> {
    if (!Application._runtimeRegistry) {
      throw new Error(
        'No runtime available. Import "kento" instead of "@kento/core" to use app.listen(), ' +
        'or set Application._runtimeRegistry manually.'
      )
    }
    return Application._runtimeRegistry(options.runtime ?? 'node', this, options)
  }

  constructor(options: KentoOptions = {}) {
    super()
    this.proxy = options.proxy ?? false
    this.subdomainOffset = options.subdomainOffset ?? 2
    this.proxyIpHeader = options.proxyIpHeader ?? 'X-Forwarded-For'
    this.maxIpsCount = options.maxIpsCount ?? 0
    this.env = options.env ?? process.env.NODE_ENV ?? 'development'
    this.silent = options.silent ?? false
    if (options.keys) this.keys = options.keys
    this.middleware = []
    this.context = Object.create(context)
    this.request = Object.create(request)
    this.response = Object.create(response)
  }

  toJSON() {
    return { subdomainOffset: this.subdomainOffset, proxy: this.proxy, env: this.env }
  }

  inspect() { return this.toJSON() }

  use(fn: Middleware<S, C>): this {
    if (typeof fn !== 'function') throw new TypeError('middleware must be a function!')
    this.middleware.push(fn)
    return this
  }

  callback(): (req: Request, platform?: KentoPlatform | LegacyRuntimeLike) => Promise<Response> {
    return this.fetch.bind(this)
  }

  async fetch(req: Request, platform?: KentoPlatform | LegacyRuntimeLike): Promise<Response> {
    const fn = compose(this.middleware)
    if (!this.listenerCount('error')) this.on('error', this.onerror.bind(this))

    const ctx = this.createContext(req, platform)
    return this.handleRequest(ctx, fn)
  }

  async handleRequest(
    ctx: ParameterizedContext<S, C>,
    fnMiddleware: ReturnType<typeof compose<S, C>>
  ): Promise<Response> {
    try {
      await fnMiddleware(ctx)
    } catch (err: any) {
      ;(ctx as any).onerror(err)
    }
    return respond(ctx)
  }

  createContext(
    req: Request,
    platform?: KentoPlatform | LegacyRuntimeLike
  ): ParameterizedContext<S, C> {
    const ctx = Object.create(this.context) as ParameterizedContext<S, C>
    const reqObj = Object.create(this.request)
    const resObj = Object.create(this.response)
    const normalizedPlatform = normalizePlatform(req, platform)

    ;(ctx as any).request = reqObj
    ;(ctx as any).response = resObj
    ;(ctx as any).app = reqObj.app = resObj.app = this
    ;(ctx as any).req = reqObj.req = req
    ;(ctx as any).platform = normalizedPlatform
    reqObj.ctx = resObj.ctx = ctx
    reqObj.response = resObj
    resObj.request = reqObj

    const parsed = new URL(req.url)
    const urlPath = parsed.pathname + parsed.search
    ;(ctx as any).originalUrl = reqObj.originalUrl = urlPath
    reqObj._url = urlPath
    ;(ctx as any).state = {} as S

    // Initialize response state
    resObj._headers = new Headers()
    resObj._status = 404
    resObj._body = null
    resObj._explicitStatus = false
    resObj._explicitNullBody = false
    resObj._statusMessage = ''

    return ctx
  }

  onerror(err: Error): void {
    const isNativeError =
      Object.prototype.toString.call(err) === '[object Error]' || err instanceof Error
    if (!isNativeError) throw new TypeError(`non-error thrown: ${JSON.stringify(err)}`)

    if ((err as any).status === 404 || (err as any).expose) return
    if (this.silent) return

    const msg = err.stack || err.toString()
    console.error(`\n${msg.replace(/^/gm, '  ')}\n`)
  }

  static get default() { return Application }
}

function respond(ctx: ParameterizedContext): Response {
  if ((ctx as any).respond === false) {
    return new Response(null, { status: 200 })
  }

  let body = (ctx as any).response._body
  const status: number = (ctx as any).response._status ?? 404
  const headers: Headers = (ctx as any).response._headers

  if (EMPTY_STATUSES.has(status)) {
    return new Response(null, { status, headers })
  }

  if ((ctx as any).method === 'HEAD') {
    // Set Content-Length for HEAD if not already set
    if (!headers.has('Content-Length')) {
      const len = (ctx as any).response.length
      if (Number.isInteger(len)) headers.set('Content-Length', String(len))
    }
    return new Response(null, { status, headers })
  }

  if (body === null || body === undefined) {
    if ((ctx as any).response._explicitNullBody) {
      headers.delete('Content-Type')
      headers.delete('Transfer-Encoding')
      return new Response(null, { status, headers })
    }
    body = STATUS_CODES[status] || String(status)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'text/plain; charset=utf-8')
    }
    return new Response(body, { status, headers })
  }

  if (typeof body === 'string') return new Response(body, { status, headers })
  if (Buffer.isBuffer(body)) return new Response(body as BodyInit, { status, headers })
  if (body instanceof Uint8Array) return new Response(body as BodyInit, { status, headers })
  if (body instanceof ArrayBuffer) return new Response(body, { status, headers })
  if (body instanceof Blob) return new Response(body, { status, headers })
  if (body instanceof ReadableStream) return new Response(body, { status, headers })

  if (body instanceof Response) {
    // Merge our headers into the Response
    const merged = new Headers(body.headers)
    headers.forEach((v, k) => merged.set(k, v))
    return new Response(body.body, { status, headers: merged })
  }

  // JSON
  const json = JSON.stringify(body)
  if (!headers.has('Content-Length')) {
    headers.set('Content-Length', String(Buffer.byteLength(json)))
  }
  return new Response(json, { status, headers })
}

export default Application
