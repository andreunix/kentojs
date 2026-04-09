import { Application, type DefaultContext, type DefaultState, type KentoOptions, type Middleware } from '../../core/src/index.ts'
type BunServer = import('bun').Server<unknown>

export interface BunRuntimePlatform {
  clientAddress?: string
  waitUntil?: (promise: Promise<unknown>) => void
  env?: Record<string, string | undefined>
}

export type BunListenOptions = Omit<Parameters<typeof Bun.serve>[0], 'fetch'>
export type BunRuntimeListenOptions = BunListenOptions & {
  env?: Record<string, string | undefined>
}

export interface BunRuntimeOptions {
  serve?: typeof Bun.serve
}

type RuntimeCallback<S extends DefaultState, C extends DefaultContext> = (
  req: Request,
  platform?: BunRuntimePlatform
) => Response | Promise<Response>

function resolveListenOptions(port?: number | BunRuntimeListenOptions): BunRuntimeListenOptions {
  if (typeof port === 'number') return { port }
  return port ?? {}
}

export class BunRuntimeApp<
  S extends DefaultState = DefaultState,
  C extends DefaultContext = DefaultContext
> {
  readonly app: Application<S, C>
  private readonly serve: typeof Bun.serve
  private handler?: RuntimeCallback<S, C>
  server?: BunServer

  constructor(appOrOptions?: Application<S, C> | KentoOptions, options: BunRuntimeOptions = {}) {
    this.app = appOrOptions instanceof Application ? appOrOptions : new Application<S, C>(appOrOptions)
    this.serve = options.serve ?? Bun.serve
  }

  use(fn: Middleware<S, C>): this {
    this.app.use(fn)
    this.handler = undefined
    return this
  }

  fetch(req: Request, platform?: BunRuntimePlatform): Response | Promise<Response> {
    return this.getHandler()(req, platform)
  }

  callback(): RuntimeCallback<S, C> {
    return this.getHandler()
  }

  listen(port?: number | BunRuntimeListenOptions, callback?: () => void): BunServer {
    const options = resolveListenOptions(port)
    const serveOptions = {
      ...options,
      fetch: (req: Request, server: BunServer) => {
        const platform: BunRuntimePlatform = {
          clientAddress: server.requestIP?.(req)?.address,
          env: options.env
        }
        return this.fetch(req, platform)
      }
    } as Parameters<typeof Bun.serve>[0]

    this.server = this.serve(serveOptions as any)

    if (callback) callback()
    return this.server
  }

  close(): void {
    this.server?.stop()
    this.server = undefined
  }

  private getHandler(): RuntimeCallback<S, C> {
    if (!this.handler) {
      const coreCallback = this.app.callback()
      this.handler = (req: Request, platform?: BunRuntimePlatform) => {
        return coreCallback(req, platform)
      }
    }

    return this.handler
  }
}

export function createBunRuntime<
  S extends DefaultState = DefaultState,
  C extends DefaultContext = DefaultContext
>(appOrOptions?: Application<S, C> | KentoOptions, options: BunRuntimeOptions = {}): BunRuntimeApp<S, C> {
  return new BunRuntimeApp(appOrOptions, options)
}

export interface BunRuntimeServerHandle<
  S extends DefaultState = DefaultState,
  C extends DefaultContext = DefaultContext
> {
  runtime: BunRuntimeApp<S, C>
  server: BunServer
  port: number
  hostname: string
  origin: string
  close(): void
}

export function listen<
  S extends DefaultState = DefaultState,
  C extends DefaultContext = DefaultContext
>(
  app: Application<S, C>,
  options?: number | BunRuntimeListenOptions,
  runtimeOptions: BunRuntimeOptions = {}
): BunRuntimeServerHandle<S, C> {
  const runtime = createBunRuntime(app, runtimeOptions)
  const listenOptions = resolveListenOptions(options)
  const server = runtime.listen(listenOptions)
  const hostname = listenOptions.hostname ?? '127.0.0.1'
  const fallbackPort =
    typeof listenOptions.port === 'number'
      ? listenOptions.port
      : Number(listenOptions.port ?? 3000)
  const port = server.port ?? fallbackPort

  return {
    runtime,
    server,
    port,
    hostname,
    origin: `http://${hostname}:${port}`,
    close() {
      runtime.close()
    }
  }
}

export default createBunRuntime
