import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export interface NodeRuntimePlatform {
  clientAddress?: string | null
  env: Record<string, string | undefined>
  waitUntil: (promise: Promise<unknown>) => void
  signal: AbortSignal
}

export interface NodeRuntimeOptions {
  port?: number
  hostname?: string
  trustProxy?: boolean
  env?: Record<string, string | undefined>
  serverFactory?: (
    listener: (req: IncomingMessage, res: ServerResponse) => void
  ) => Server
}

export interface NodeFetchApp {
  fetch(request: Request, platform?: NodeRuntimePlatform): Response | Promise<Response>
}

export interface NodeListenOptions {
  port?: number
  hostname?: string
  reusePort?: boolean
}

export interface NodeRuntimeServerHandle {
  runtime: NodeRuntime
  server: Server
  port: number
  hostname: string
  origin: string
  close(): Promise<void>
}

interface NodeRequestInit extends RequestInit {
  duplex?: 'half'
}

const EMPTY_RESPONSE_STATUSES = new Set([204, 205, 304])

const VALID_HOST_RE = /^[a-zA-Z0-9\-._\[\]:]+$/

function parseHostHeader(host: string | null | undefined): string {
  if (!host) return '127.0.0.1'
  // Strip port for validation purposes, reassemble after check
  const hostOnly = host.split(':')[0] ?? ''
  if (!VALID_HOST_RE.test(host) || !hostOnly) {
    const err: NodeJS.ErrnoException = new Error('Invalid Host header')
    ;(err as any).status = 400
    ;(err as any).expose = true
    throw err
  }
  return host
}

function buildRequestUrl(req: IncomingMessage, trustProxy: boolean): string {
  const rawUrl = req.url ?? '/'
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl

  const host = parseHostHeader(
    Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host
  )

  const socket = req.socket as typeof req.socket & { encrypted?: boolean }
  let protocol = socket.encrypted ? 'https' : 'http'

  if (trustProxy) {
    const protoHeader = Array.isArray(req.headers['x-forwarded-proto'])
      ? req.headers['x-forwarded-proto'][0]
      : req.headers['x-forwarded-proto']
    const forwarded = protoHeader?.split(',')[0]?.trim()
    if (forwarded === 'https' || forwarded === 'http') {
      protocol = forwarded
    }
  }

  return new URL(rawUrl, `${protocol}://${host}`).toString()
}

function appendHeaders(target: Headers, req: IncomingMessage): void {
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]
    const value = req.rawHeaders[i + 1]
    if (name && value !== undefined) target.append(name, value)
  }
}

function createAbortSignal(req: IncomingMessage): AbortSignal {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted) controller.abort()
  }

  req.once('aborted', abort)
  req.once('close', abort)
  return controller.signal
}

function resolveClientAddress(req: IncomingMessage, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for']
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
    if (value) return value.split(',')[0]?.trim() || null
  }

  return req.socket.remoteAddress ?? null
}

export function createRequestFromIncomingMessage(
  req: IncomingMessage,
  options: { trustProxy?: boolean } = {}
): Request {
  const headers = new Headers()
  appendHeaders(headers, req)

  const method = (req.method ?? 'GET').toUpperCase()
  const signal = createAbortSignal(req)
  const init: NodeRequestInit = {
    method,
    headers,
    signal,
  }

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as BodyInit
    init.duplex = 'half'
  }

  return new Request(buildRequestUrl(req, options.trustProxy ?? false), init)
}

export async function writeResponseToServerResponse(
  response: Response,
  res: ServerResponse
): Promise<void> {
  res.statusCode = response.status
  res.statusMessage = response.statusText || res.statusMessage

  for (const [name, value] of response.headers.entries()) {
    if (name === 'set-cookie') continue
    res.setHeader(name, value)
  }

  const headersWithDuplicates = response.headers as Headers & {
    getSetCookie?: () => string[]
  }
  const setCookies =
    typeof headersWithDuplicates.getSetCookie === 'function'
      ? headersWithDuplicates.getSetCookie()
      : []
  if (setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies)
  }

  if (EMPTY_RESPONSE_STATUSES.has(response.status)) {
    res.end()
    return
  }

  if (!response.body) {
    res.end()
    return
  }

  const stream = Readable.fromWeb(response.body as any)
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onFinish = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      stream.off('error', onError)
      res.off('error', onError)
      res.off('finish', onFinish)
    }

    stream.once('error', onError)
    res.once('error', onError)
    res.once('finish', onFinish)
    stream.pipe(res)
  })
}

export class NodeRuntime {
  readonly app: NodeFetchApp
  readonly options: NodeRuntimeOptions
  server?: Server

  constructor(app: NodeFetchApp, options: NodeRuntimeOptions = {}) {
    this.app = app
    this.options = options
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pending: Promise<unknown>[] = []

    try {
      const request = createRequestFromIncomingMessage(req, {
        trustProxy: this.options.trustProxy,
      })

      const platform: NodeRuntimePlatform = {
        clientAddress: resolveClientAddress(req, this.options.trustProxy ?? false),
        env: this.options.env ?? process.env,
        waitUntil(promise: Promise<unknown>) {
          pending.push(Promise.resolve(promise).catch(() => undefined))
        },
        signal: request.signal,
      }

      const response = await this.app.fetch(request, platform)
      await writeResponseToServerResponse(response, res)
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error && typeof (error as any).status === 'number'
        ? (error as any).status
        : 500
      const message = status >= 500 ? 'Internal Server Error' : String((error as Error)?.message ?? error)
      await writeResponseToServerResponse(new Response(message, { status }), res)
    } finally {
      void Promise.allSettled(pending)
    }
  }

  listen(options?: number | NodeListenOptions, callback?: () => void): Server {
    const listenOptions =
      typeof options === 'number'
        ? { port: options }
        : { port: options?.port, hostname: options?.hostname, reusePort: options?.reusePort }

    const server = (this.options.serverFactory ?? createServer)((req, res) => {
      void this.handleRequest(req, res)
    })

    this.server = server
    server.listen(
      {
        port: listenOptions.port ?? this.options.port ?? 3000,
        hostname: listenOptions.hostname ?? this.options.hostname,
        reusePort: listenOptions.reusePort,
      },
      callback
    )

    return server
  }

  async close(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve, reject) => {
      this.server?.close(error => {
        if (error) reject(error)
        else resolve()
      })
    })
    this.server = undefined
  }
}

export function createNodeRuntime(app: NodeFetchApp, options: NodeRuntimeOptions = {}): NodeRuntime {
  return new NodeRuntime(app, options)
}

export async function listen(
  app: NodeFetchApp,
  options: NodeRuntimeOptions & NodeListenOptions = {}
): Promise<NodeRuntimeServerHandle> {
  const runtime = createNodeRuntime(app, options)

  const server = await new Promise<Server>((resolve, reject) => {
    const instance = runtime.listen(options, () => resolve(instance))
    instance.once('error', reject)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await runtime.close().catch(() => undefined)
    throw new Error('Expected a TCP address from node runtime server')
  }

  const hostname = options.hostname ?? '127.0.0.1'
  return {
    runtime,
    server,
    port: address.port,
    hostname,
    origin: `http://${hostname}:${address.port}`,
    close() {
      return runtime.close()
    }
  }
}
