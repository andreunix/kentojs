export interface KentoOptions {
  env?: string
  keys?: string[]
  proxy?: boolean
  subdomainOffset?: number
  proxyIpHeader?: string
  maxIpsCount?: number
  silent?: boolean
}

export type Next = () => Promise<void>

export type Middleware<S = DefaultState, C = DefaultContext> = (
  ctx: ParameterizedContext<S, C>,
  next: Next
) => Promise<void> | void

export interface DefaultState {}
export interface DefaultContext {}

export interface KentoClientAddress {
  address: string
  port?: number
}

export interface KentoPlatform {
  name?: string
  clientAddress?: string | KentoClientAddress | null
  waitUntil?: (promise: Promise<unknown>) => void
  env?: Record<string, unknown>
}

export interface KentoRequest {
  app: import('./application.ts').Application
  req: Request
  ctx: KentoContext
  response: KentoResponse
  originalUrl: string
  header: Record<string, string>
  headers: Record<string, string>
  url: string
  origin: string | null
  href: string
  method: string
  path: string
  query: Record<string, string | string[]>
  querystring: string
  search: string
  host: string
  hostname: string
  URL: URL
  fresh: boolean
  stale: boolean
  idempotent: boolean
  charset: string
  length: number | undefined
  protocol: string
  secure: boolean
  ips: string[]
  ip: string
  subdomains: string[]
  body?: unknown
  rawBody?: string
  accepts(...types: string[]): string | false | string[]
  acceptsEncodings(...encodings: string[]): string | false | string[]
  acceptsCharsets(...charsets: string[]): string | false | string[]
  acceptsLanguages(...languages: string[]): string | false | string[]
  is(type: string, ...types: string[]): string | false | null
  get(field: string): string
  toJSON(): object
}

export interface KentoResponse {
  app: import('./application.ts').Application
  req: Request
  ctx: KentoContext
  request: KentoRequest
  header: Record<string, string>
  headers: Record<string, string>
  status: number
  message: string
  body: unknown
  length: number | undefined
  headerSent: boolean
  writable: boolean
  type: string
  lastModified: Date | undefined
  etag: string
  vary(field: string): void
  redirect(url: string): void
  back(alt?: string): void
  attachment(filename?: string, options?: { type?: string; fallback?: string }): void
  set(field: string | Record<string, unknown>, val?: unknown): void
  append(field: string, val: string | string[]): void
  remove(field: string): void
  has(field: string): boolean
  get(field: string): string | null
  is(type: string, ...types: string[]): string | false
  flushHeaders(): void
  toJSON(): object
}

export interface KentoContext<S = DefaultState, C = DefaultContext> {
  app: import('./application.ts').Application
  req: Request
  platform: KentoPlatform
  request: KentoRequest
  response: KentoResponse
  originalUrl: string
  state: S & Record<string, unknown>
  respond?: boolean
  header: Record<string, string>
  headers: Record<string, string>
  url: string
  origin: string | null
  href: string
  method: string
  path: string
  query: Record<string, string | string[]>
  querystring: string
  search: string
  host: string
  hostname: string
  URL: URL
  fresh: boolean
  stale: boolean
  idempotent: boolean
  charset: string
  ip: string
  ips: string[]
  subdomains: string[]
  body?: unknown
  rawBody?: string
  status: number
  message: string
  length: number | undefined
  type: string
  lastModified: Date | undefined
  etag: string
  headerSent: boolean
  writable: boolean
  throw(status: number, message?: string, properties?: object): never
  throw(message: string): never
  throw(error: Error): never
  assert(value: unknown, status?: number, message?: string, properties?: object): asserts value
  onerror(err: Error | null): void
  cookies: Record<string, string>
  accepts(...types: string[]): string | false | string[]
  acceptsEncodings(...encodings: string[]): string | false | string[]
  acceptsCharsets(...charsets: string[]): string | false | string[]
  acceptsLanguages(...languages: string[]): string | false | string[]
  is(type: string, ...types: string[]): string | false | null
  get(field: string): string
  set(field: string | Record<string, unknown>, val?: unknown): void
  append(field: string, val: string | string[]): void
  remove(field: string): void
  has(field: string): boolean
  vary(field: string): void
  redirect(url: string): void
  back(alt?: string): void
  attachment(filename?: string, options?: object): void
  flushHeaders(): void
  toJSON(): object
  inspect(): object
}

export type ParameterizedContext<
  S = DefaultState,
  C = DefaultContext
> = KentoContext<S, C> & C
