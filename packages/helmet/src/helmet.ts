import type { Middleware } from '@kento/core'

export interface HelmetOptions {
  contentSecurityPolicy?: false | ContentSecurityPolicyOptions
  crossOriginEmbedderPolicy?: false | { policy?: string }
  crossOriginOpenerPolicy?: false | { policy?: string }
  crossOriginResourcePolicy?: false | { policy?: string }
  dnsPrefetchControl?: false | { allow?: boolean }
  frameguard?: false | { action?: 'deny' | 'sameorigin' }
  hsts?: false | { maxAge?: number; includeSubDomains?: boolean; preload?: boolean }
  ieNoOpen?: false
  noSniff?: false
  permittedCrossDomainPolicies?: false | { permittedPolicies?: string }
  referrerPolicy?: false | { policy?: string | string[] }
  xssFilter?: false
  originAgentCluster?: false
}

interface ContentSecurityPolicyOptions {
  directives?: Record<string, string | string[]>
  reportOnly?: boolean
  useDefaults?: boolean
}

const DEFAULT_CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'font-src': ["'self'", 'https:', 'data:'],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'object-src': ["'none'"],
  'script-src': ["'self'"],
  'script-src-attr': ["'none'"],
  'style-src': ["'self'", 'https:', "'unsafe-inline'"],
  'upgrade-insecure-requests': []
}

function buildCsp(options?: ContentSecurityPolicyOptions): string {
  const useDefaults = options?.useDefaults !== false
  const directives = useDefaults
    ? { ...DEFAULT_CSP_DIRECTIVES, ...(options?.directives ?? {}) }
    : (options?.directives ?? DEFAULT_CSP_DIRECTIVES)

  return Object.entries(directives)
    .map(([key, value]) => {
      const values = Array.isArray(value) ? value : [value]
      return values.length > 0 ? `${key} ${values.join(' ')}` : key
    })
    .join('; ')
}

export function helmet(options: HelmetOptions = {}): Middleware {
  // Pre-compute all headers at middleware creation time for performance
  const headers: [string, string][] = []

  // Content-Security-Policy
  if (options.contentSecurityPolicy !== false) {
    const cspOpts = typeof options.contentSecurityPolicy === 'object'
      ? options.contentSecurityPolicy : undefined
    const cspValue = buildCsp(cspOpts)
    const headerName = cspOpts?.reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy'
    headers.push([headerName, cspValue])
  }

  // Cross-Origin-Embedder-Policy
  if (options.crossOriginEmbedderPolicy !== false) {
    const policy = (typeof options.crossOriginEmbedderPolicy === 'object'
      ? options.crossOriginEmbedderPolicy.policy : undefined) ?? 'require-corp'
    headers.push(['Cross-Origin-Embedder-Policy', policy])
  }

  // Cross-Origin-Opener-Policy
  if (options.crossOriginOpenerPolicy !== false) {
    const policy = (typeof options.crossOriginOpenerPolicy === 'object'
      ? options.crossOriginOpenerPolicy.policy : undefined) ?? 'same-origin'
    headers.push(['Cross-Origin-Opener-Policy', policy])
  }

  // Cross-Origin-Resource-Policy
  if (options.crossOriginResourcePolicy !== false) {
    const policy = (typeof options.crossOriginResourcePolicy === 'object'
      ? options.crossOriginResourcePolicy.policy : undefined) ?? 'same-origin'
    headers.push(['Cross-Origin-Resource-Policy', policy])
  }

  // DNS Prefetch Control
  if (options.dnsPrefetchControl !== false) {
    const allow = typeof options.dnsPrefetchControl === 'object'
      ? options.dnsPrefetchControl.allow : false
    headers.push(['X-DNS-Prefetch-Control', allow ? 'on' : 'off'])
  }

  // X-Frame-Options (frameguard)
  if (options.frameguard !== false) {
    const action = (typeof options.frameguard === 'object'
      ? options.frameguard.action : undefined) ?? 'sameorigin'
    headers.push(['X-Frame-Options', action.toUpperCase()])
  }

  // Strict-Transport-Security (HSTS)
  if (options.hsts !== false) {
    const hstsOpts = typeof options.hsts === 'object' ? options.hsts : {}
    const maxAge = hstsOpts.maxAge ?? 15552000 // 180 days
    let value = `max-age=${maxAge}`
    if (hstsOpts.includeSubDomains !== false) value += '; includeSubDomains'
    if (hstsOpts.preload) value += '; preload'
    headers.push(['Strict-Transport-Security', value])
  }

  // X-Download-Options (ieNoOpen)
  if (options.ieNoOpen !== false) {
    headers.push(['X-Download-Options', 'noopen'])
  }

  // X-Content-Type-Options (noSniff)
  if (options.noSniff !== false) {
    headers.push(['X-Content-Type-Options', 'nosniff'])
  }

  // X-Permitted-Cross-Domain-Policies
  if (options.permittedCrossDomainPolicies !== false) {
    const policy = (typeof options.permittedCrossDomainPolicies === 'object'
      ? options.permittedCrossDomainPolicies.permittedPolicies : undefined) ?? 'none'
    headers.push(['X-Permitted-Cross-Domain-Policies', policy])
  }

  // Referrer-Policy
  if (options.referrerPolicy !== false) {
    const policy = typeof options.referrerPolicy === 'object'
      ? options.referrerPolicy.policy : undefined
    const value = Array.isArray(policy) ? policy.join(', ')
      : (policy ?? 'no-referrer')
    headers.push(['Referrer-Policy', value])
  }

  // X-XSS-Protection — set to 0 (modern best practice is to disable it and rely on CSP)
  if (options.xssFilter !== false) {
    headers.push(['X-XSS-Protection', '0'])
  }

  // Origin-Agent-Cluster
  if (options.originAgentCluster !== false) {
    headers.push(['Origin-Agent-Cluster', '?1'])
  }

  return async function helmetMiddleware(ctx, next) {
    for (const [name, value] of headers) {
      ctx.set(name, value)
    }
    return next()
  }
}

// Individual middleware exports for granular control
helmet.contentSecurityPolicy = (opts?: ContentSecurityPolicyOptions): Middleware => {
  const csp = buildCsp(opts)
  const headerName = opts?.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'
  return async (ctx, next) => { ctx.set(headerName, csp); return next() }
}

helmet.hsts = (opts?: { maxAge?: number; includeSubDomains?: boolean; preload?: boolean }): Middleware => {
  const maxAge = opts?.maxAge ?? 15552000
  let value = `max-age=${maxAge}`
  if (opts?.includeSubDomains !== false) value += '; includeSubDomains'
  if (opts?.preload) value += '; preload'
  return async (ctx, next) => { ctx.set('Strict-Transport-Security', value); return next() }
}

helmet.frameguard = (opts?: { action?: 'deny' | 'sameorigin' }): Middleware => {
  const action = (opts?.action ?? 'sameorigin').toUpperCase()
  return async (ctx, next) => { ctx.set('X-Frame-Options', action); return next() }
}

helmet.noSniff = (): Middleware => {
  return async (ctx, next) => { ctx.set('X-Content-Type-Options', 'nosniff'); return next() }
}

helmet.referrerPolicy = (opts?: { policy?: string | string[] }): Middleware => {
  const value = Array.isArray(opts?.policy) ? opts!.policy.join(', ') : (opts?.policy ?? 'no-referrer')
  return async (ctx, next) => { ctx.set('Referrer-Policy', value); return next() }
}

helmet.dnsPrefetchControl = (opts?: { allow?: boolean }): Middleware => {
  return async (ctx, next) => { ctx.set('X-DNS-Prefetch-Control', opts?.allow ? 'on' : 'off'); return next() }
}

export default helmet
