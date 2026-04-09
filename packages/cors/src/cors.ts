import { varyAppend, type Middleware, type KentoContext } from '@kento/core'

export interface CorsOptions {
  origin?: string | ((ctx: KentoContext) => string | Promise<string>)
  allowMethods?: string | string[]
  exposeHeaders?: string | string[]
  allowHeaders?: string | string[]
  maxAge?: number | string
  credentials?: boolean | ((ctx: KentoContext) => boolean | Promise<boolean>)
  keepHeadersOnError?: boolean
  secureContext?: boolean
  privateNetworkAccess?: boolean
}

export function cors(options: CorsOptions = {}): Middleware {
  const opts = {
    allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH',
    secureContext: false,
    keepHeadersOnError: true,
    ...options
  }

  if (Array.isArray(opts.exposeHeaders)) opts.exposeHeaders = opts.exposeHeaders.join(',')
  if (Array.isArray(opts.allowMethods)) opts.allowMethods = opts.allowMethods.join(',')
  if (Array.isArray(opts.allowHeaders)) opts.allowHeaders = opts.allowHeaders.join(',')
  if (opts.maxAge) opts.maxAge = String(opts.maxAge)

  return async function corsMiddleware(ctx, next) {
    const requestOrigin = ctx.get('Origin')
    ctx.vary('Origin')

    let origin: string
    if (typeof opts.origin === 'function') {
      origin = await opts.origin(ctx as unknown as KentoContext)
      if (!origin) return next()
    } else {
      origin = opts.origin ?? '*'
    }

    let credentials: boolean
    if (typeof opts.credentials === 'function') {
      credentials = await opts.credentials(ctx as unknown as KentoContext)
    } else {
      credentials = !!opts.credentials
    }

    if (credentials && origin === '*') origin = requestOrigin

    const headersSet: Record<string, string> = {}

    function set(key: string, value: string) {
      ctx.set(key, value)
      headersSet[key] = value
    }

    if (ctx.method !== 'OPTIONS') {
      set('Access-Control-Allow-Origin', origin)
      if (credentials) set('Access-Control-Allow-Credentials', 'true')
      if (opts.exposeHeaders) set('Access-Control-Expose-Headers', opts.exposeHeaders as string)
      if (opts.secureContext) {
        set('Cross-Origin-Opener-Policy', 'same-origin')
        set('Cross-Origin-Embedder-Policy', 'require-corp')
      }

      if (!opts.keepHeadersOnError) return next()

      try {
        return await next()
      } catch (err: any) {
        const errHeaders = err.headers || {}
        const varyWithOrigin = varyAppend(errHeaders.vary || errHeaders.Vary || '', 'Origin')
        delete errHeaders.Vary
        err.headers = { ...errHeaders, ...headersSet, vary: varyWithOrigin }
        throw err
      }
    } else {
      if (!ctx.get('Access-Control-Request-Method')) return next()

      ctx.set('Access-Control-Allow-Origin', origin)
      if (credentials) ctx.set('Access-Control-Allow-Credentials', 'true')
      if (opts.maxAge) ctx.set('Access-Control-Max-Age', opts.maxAge as string)
      if (opts.privateNetworkAccess && ctx.get('Access-Control-Request-Private-Network')) {
        ctx.set('Access-Control-Allow-Private-Network', 'true')
      }
      if (opts.allowMethods) ctx.set('Access-Control-Allow-Methods', opts.allowMethods as string)
      if (opts.secureContext) {
        set('Cross-Origin-Opener-Policy', 'same-origin')
        set('Cross-Origin-Embedder-Policy', 'require-corp')
      }

      let allowHeaders = opts.allowHeaders as string | undefined
      if (!allowHeaders) allowHeaders = ctx.get('Access-Control-Request-Headers')
      if (allowHeaders) ctx.set('Access-Control-Allow-Headers', allowHeaders)

      ctx.status = 204
    }
  }
}

export default cors
