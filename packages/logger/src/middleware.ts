import type { Middleware, KentoContext } from '@kento/core'
import type { Logger } from './logger'

export interface LoggerMiddlewareOptions {
  /** Custom message for the request log line */
  msg?: (ctx: KentoContext, ms: number) => string

  /** Fields to include from the request */
  customProps?: (ctx: KentoContext) => Record<string, unknown>

  /** Skip logging for certain requests */
  skip?: (ctx: KentoContext) => boolean

  /**
   * Log level to use based on status code.
   * Defaults: 5xx → error, 4xx → warn, rest → info
   */
  customLogLevel?: (ctx: KentoContext, statusCode: number) => 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
}

export function loggerMiddleware(logger: Logger, opts: LoggerMiddlewareOptions = {}): Middleware {
  const getMessage = opts.msg ?? defaultMessage
  const getLevel = opts.customLogLevel ?? defaultLogLevel

  return async function kentoLogger(ctx, next) {
    const start = performance.now()
    const reqId = ctx.get('X-Request-Id') || generateId()

    // Attach logger to context for downstream use
    const reqLogger = logger.child({ reqId })
    ;(ctx as any).log = reqLogger

    reqLogger.trace('request started', {
      method: ctx.method,
      url: ctx.url,
      userAgent: ctx.get('User-Agent'),
      ip: ctx.ip,
    })

    try {
      await next()
    } catch (err) {
      // Log the error, then re-throw for the error handler
      reqLogger.error('request errored', {
        err: err as Error,
        method: ctx.method,
        url: ctx.url,
      })
      throw err
    }

    if (opts.skip?.(ctx as unknown as KentoContext)) return

    const ms = performance.now() - start
    const status = ctx.status
    const level = getLevel(ctx as unknown as KentoContext, status)
    const msg = getMessage(ctx as unknown as KentoContext, ms)

    const extra: Record<string, unknown> = {
      method: ctx.method,
      url: ctx.url,
      status,
      responseTime: Math.round(ms * 100) / 100,
      contentLength: ctx.length,
    }

    if (opts.customProps) {
      Object.assign(extra, opts.customProps(ctx as unknown as KentoContext))
    }

    reqLogger[level](msg, extra)
  }
}

function defaultMessage(_ctx: KentoContext, ms: number): string {
  return `request completed in ${ms.toFixed(2)}ms`
}

function defaultLogLevel(_ctx: KentoContext, status: number): 'info' | 'warn' | 'error' {
  if (status >= 500) return 'error'
  if (status >= 400) return 'warn'
  return 'info'
}

// Simple alphanumeric ID generator — no crypto dep needed for request IDs
let counter = 0
function generateId(): string {
  const ts = Date.now().toString(36)
  const c = (counter++).toString(36)
  const r = Math.random().toString(36).slice(2, 6)
  return `${ts}-${c}-${r}`
}
