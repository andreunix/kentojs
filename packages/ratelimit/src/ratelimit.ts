import type { Middleware, KentoContext } from '@kento/core'
import { formatMs } from '@kento/core/src/utils'

export interface RateLimitOptions {
  driver?: 'memory'
  duration?: number
  max?: number
  db?: Map<string, unknown>
  id?: (ctx: KentoContext) => string | false
  headers?: {
    remaining?: string
    reset?: string
    total?: string
  }
  whitelist?: (ctx: KentoContext) => boolean | Promise<boolean>
  blacklist?: (ctx: KentoContext) => boolean | Promise<boolean>
  onLimited?: (ctx: KentoContext) => void
  errorMessage?: string
  throw?: boolean
  disableHeader?: boolean
  status?: number
}

interface LimitEntry {
  total: number
  remaining: number
  reset: number
}

class MemoryStore {
  private store: Map<string, { count: number; reset: number }>
  private max: number
  private duration: number
  private lastCleanup = Date.now()
  private cleanupInterval: number

  constructor(max: number, duration: number, db?: Map<string, unknown>) {
    this.store = (db as Map<string, any>) ?? new Map()
    this.max = max
    this.duration = duration
    // Cleanup expired entries every 10x the duration (min 60s, max 10min)
    this.cleanupInterval = Math.max(60_000, Math.min(600_000, duration * 10))
  }

  async get(id: string): Promise<LimitEntry> {
    const now = Date.now()

    // Periodic cleanup of expired entries to prevent memory leak
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.lastCleanup = now
      for (const [key, entry] of this.store) {
        if (now > entry.reset) this.store.delete(key)
      }
    }

    let entry = this.store.get(id)

    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + this.duration }
      this.store.set(id, entry)
    }

    entry.count++

    return {
      total: this.max,
      remaining: Math.max(0, this.max - entry.count),
      reset: Math.ceil(entry.reset / 1000)
    }
  }
}

export function rateLimit(options: RateLimitOptions = {}): Middleware {
  const opts = {
    driver: 'memory' as const,
    duration: 60 * 60 * 1000,
    max: 2500,
    db: new Map<string, unknown>(),
    id: (ctx: any) => ctx.ip as string | false,
    whitelist: undefined as any,
    blacklist: undefined as any,
    onLimited: undefined as any,
    errorMessage: '',
    throw: false,
    disableHeader: false,
    status: 429,
    ...options,
    headers: {
      remaining: 'X-RateLimit-Remaining',
      reset: 'X-RateLimit-Reset',
      total: 'X-RateLimit-Limit',
      ...options.headers
    }
  }

  const { remaining: remainingHeader, reset: resetHeader, total: totalHeader } = opts.headers
  const store = new MemoryStore(opts.max, opts.duration, opts.db)

  return async function rateLimitMiddleware(ctx, next) {
    const id = opts.id(ctx as any)

    const whitelisted = typeof opts.whitelist === 'function' && await opts.whitelist(ctx as any)
    const blacklisted = typeof opts.blacklist === 'function' && await opts.blacklist(ctx as any)

    if (blacklisted) ctx.throw(403, 'Forbidden')
    if (id === false || whitelisted) return next()

    const limit = await store.get(String(id))
    const calls = limit.remaining > 0 ? limit.remaining - 1 : 0
    const headers: Record<string, number> = {}

    if (!opts.disableHeader) {
      headers[remainingHeader!] = calls
      headers[resetHeader!] = limit.reset
      headers[totalHeader!] = limit.total
      ctx.set(headers as any)
    }

    if (limit.remaining > 0) return next()

    const delta = (limit.reset * 1000 - Date.now()) | 0
    const after = (limit.reset - Date.now() / 1000) | 0
    const message = opts.errorMessage || `Rate limit exceeded, retry in ${formatMs(delta, true)}.`

    ctx.body = message
    ctx.set('Retry-After', String(after))
    ;(ctx as any).state.rateLimit = { after, headers, id, message }
    ctx.status = opts.status

    if (opts.onLimited) opts.onLimited(ctx as any)

    if (opts.throw) {
      ctx.throw(ctx.status, message, { headers: { ...headers, 'Retry-After': after } })
    }
  }
}

export default rateLimit
