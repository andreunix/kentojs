import { compose, HttpError } from '@kento/core'
import type { Middleware, ParameterizedContext } from '@kento/core'
import Layer from './layer.ts'
import type {
  RouterOptions,
  LayerOptions,
  RouterMiddleware,
  RouterParameterMiddleware,
  RouterContext,
  Next
} from './types.ts'

const HTTP_METHODS = ['HEAD', 'OPTIONS', 'GET', 'PUT', 'PATCH', 'POST', 'DELETE']

export class Router<S = object, C = object> {
  opts: RouterOptions
  methods: string[]
  exclusive: boolean
  params: Record<string, RouterParameterMiddleware<S, C> | RouterParameterMiddleware<S, C>[]>
  stack: Layer<S, C>[]
  host?: string | string[] | RegExp

  constructor(options: RouterOptions = {}) {
    this.opts = options
    this.methods = options.methods ?? [...HTTP_METHODS]
    this.exclusive = Boolean(options.exclusive)
    this.params = {}
    this.stack = []
    this.host = options.host
  }

  static url(path: string | RegExp, ...args: unknown[]): string {
    const layer = new Layer(path, [], () => {})
    return layer.url(...args)
  }

  routes(): Middleware<S, C> & { router: Router<S, C> } {
    const router = this

    const dispatch = async (ctx: ParameterizedContext<S, C>, next: Next): Promise<void> => {
      const routerCtx = ctx as unknown as RouterContext<S, C>
      const path = (router.opts as any).routerPath ?? (ctx as any).routerPath ?? (ctx as any).path

      const matched = router.match(path, (ctx as any).method)

      if ((ctx as any).matched) {
        ;(ctx as any).matched.push(...matched.path)
      } else {
        ;(ctx as any).matched = matched.path
      }

      if (!matched.route) return next()

      const layerChain = (
        router.exclusive
          ? [matched.pathAndMethod[matched.pathAndMethod.length - 1]!]
          : matched.pathAndMethod
      ).reduce((memo: RouterMiddleware<S, C>[], layer) => {
        memo.push((ctx, next) => {
          routerCtx.captures = layer.captures(path)
          routerCtx.params = layer.params(path, routerCtx.captures, routerCtx.params ?? {})
          routerCtx.routerPath = layer.path as string
          routerCtx.routerName = layer.name
          routerCtx._matchedRoute = layer.path
          routerCtx._matchedRouteName = layer.name
          routerCtx.router = router as any
          return next()
        })
        return memo.concat(layer.stack)
      }, [])

      return compose(layerChain as Middleware<S, C>[])(ctx, next)
    }

    dispatch.router = router
    return dispatch as Middleware<S, C> & { router: Router<S, C> }
  }

  allowedMethods(options: {
    throw?: boolean
    notImplemented?: () => Error
    methodNotAllowed?: () => Error
  } = {}): Middleware<S, C> {
    const implemented = this.methods

    return async (ctx, next) => {
      await next()

      const allowed: Record<string, string> = {}

      if (!ctx.status || ctx.status === 404) {
        for (const route of this.stack) {
          if (route.match((ctx as any).path)) {
            for (const method of route.methods) {
              allowed[method] = method
            }
          }
        }

        const allowedArr = Object.keys(allowed)

        if (!~implemented.indexOf((ctx as any).method)) {
          if (options.throw) {
            throw typeof options.notImplemented === 'function'
              ? options.notImplemented()
              : new HttpError(501)
          } else {
            ctx.status = 501
            ctx.set('Allow', allowedArr.join(', '))
          }
        } else if (allowedArr.length) {
          if ((ctx as any).method === 'OPTIONS') {
            ctx.status = 200
            ctx.body = ''
            ctx.set('Allow', allowedArr.join(', '))
          } else if (!allowed[(ctx as any).method]) {
            if (options.throw) {
              throw typeof options.methodNotAllowed === 'function'
                ? options.methodNotAllowed()
                : new HttpError(405)
            } else {
              ctx.status = 405
              ctx.set('Allow', allowedArr.join(', '))
            }
          }
        }
      }
    }
  }

  use(...args: unknown[]): this {
    let path: string | string[] | undefined
    let middleware: RouterMiddleware<S, C>[]

    if (typeof args[0] === 'string' || Array.isArray(args[0])) {
      path = args[0] as string | string[]
      middleware = args.slice(1) as RouterMiddleware<S, C>[]
    } else {
      middleware = args as RouterMiddleware<S, C>[]
    }

    const paths = path ? (Array.isArray(path) ? path : [path]) : []

    for (const mw of middleware) {
      if ((mw as any).router) {
        const nested: Router<S, C> = (mw as any).router
        for (const nestedLayer of nested.stack) {
          const cloned = Object.assign(Object.create(Layer.prototype), nestedLayer, {
            stack: [...nestedLayer.stack],
            methods: [...nestedLayer.methods],
            paramNames: [...nestedLayer.paramNames],
            opts: { ...nestedLayer.opts }
          }) as Layer<S, C>
          if (paths.length) {
            for (const p of paths) cloned.setPrefix(p)
          }
          if (this.opts.prefix) cloned.setPrefix(this.opts.prefix)
          for (const [name, handler] of Object.entries(this.params)) {
            cloned.param(name, handler as RouterParameterMiddleware<S, C>)
          }
          this.stack.push(cloned)
        }
      } else {
        const layer = new Layer<S, C>(
          paths[0] ?? '(.*)',
          [],
          mw as RouterMiddleware<S, C>,
          { end: false, ignoreCaptures: !paths.length }
        )
        if (this.opts.prefix) layer.setPrefix(this.opts.prefix)
        for (const [name, handler] of Object.entries(this.params)) {
          layer.param(name, handler as RouterParameterMiddleware<S, C>)
        }
        this.stack.push(layer)
      }
    }

    return this
  }

  prefix(prefix: string): this {
    prefix = prefix.replace(/\/$/, '')
    this.opts.prefix = prefix
    for (const route of this.stack) route.setPrefix(prefix)
    return this
  }

  redirect(source: string, destination: string, code = 301): this {
    if (source[0] !== '/') {
      const named = this.route(source)
      if (named) source = named.path as string
    }
    if (destination[0] !== '/' && !/^https?:\/\//i.test(destination)) {
      const named = this.route(destination)
      if (named) destination = named.path as string
    }
    return this.all(source, (ctx: RouterContext<S, C>) => {
      ctx.redirect(destination)
      ctx.status = code
    })
  }

  route(name: string): Layer<S, C> | undefined {
    return this.stack.find(l => l.name === name)
  }

  url(name: string, ...args: unknown[]): string {
    return this.route(name)?.url(...args) ?? ''
  }

  match(path: string, method: string): {
    path: Layer<S, C>[]
    pathAndMethod: Layer<S, C>[]
    route: boolean
  } {
    const matched = { path: [] as Layer<S, C>[], pathAndMethod: [] as Layer<S, C>[], route: false }

    for (const layer of this.stack) {
      if (layer.match(path)) {
        matched.path.push(layer)
        if (layer.methods.length === 0 || ~layer.methods.indexOf(method.toUpperCase())) {
          matched.pathAndMethod.push(layer)
          if (layer.methods.length > 0) matched.route = true
        }
      }
    }

    return matched
  }

  param(param: string, middleware: RouterParameterMiddleware<S, C>): this {
    this.params[param] = middleware
    for (const route of this.stack) route.param(param, middleware)
    return this
  }

  register(
    paths: string | RegExp | (string | RegExp)[],
    methods: string[],
    middleware: RouterMiddleware<S, C> | RouterMiddleware<S, C>[],
    opts: LayerOptions = {}
  ): Layer<S, C> {
    if (Array.isArray(paths)) {
      let last!: Layer<S, C>
      for (const p of paths) last = this.register(p, methods, middleware, opts)
      return last
    }

    const middlewareArray = Array.isArray(middleware) ? middleware : [middleware]
    const route = new Layer<S, C>(paths, methods, middlewareArray, {
      end: opts.end !== false,
      name: opts.name,
      sensitive: opts.sensitive ?? this.opts.sensitive,
      strict: opts.strict ?? this.opts.strict,
      ignoreCaptures: opts.ignoreCaptures
    })

    if (this.opts.prefix) route.setPrefix(this.opts.prefix)

    for (const [name, handler] of Object.entries(this.params)) {
      route.param(name, handler as RouterParameterMiddleware<S, C>)
    }

    this.stack.push(route)
    return route
  }

  // HTTP method shortcuts
  get(...args: unknown[]): this { return this._addRoute('GET', args) }
  post(...args: unknown[]): this { return this._addRoute('POST', args) }
  put(...args: unknown[]): this { return this._addRoute('PUT', args) }
  patch(...args: unknown[]): this { return this._addRoute('PATCH', args) }
  delete(...args: unknown[]): this { return this._addRoute('DELETE', args) }
  del = this.delete
  head(...args: unknown[]): this { return this._addRoute('HEAD', args) }
  options(...args: unknown[]): this { return this._addRoute('OPTIONS', args) }
  all(...args: unknown[]): this { return this._addRoute(HTTP_METHODS, args) }

  private _addRoute(methods: string | string[], args: unknown[]): this {
    const methodsArray = Array.isArray(methods) ? methods : [methods]
    let name: string | undefined
    let path: string | RegExp | (string | RegExp)[]
    let middleware: RouterMiddleware<S, C>[]

    if (
      typeof args[0] === 'string' &&
      typeof args[1] !== 'function' &&
      !(args[1] instanceof RegExp) &&
      args.length > 2
    ) {
      name = args[0] as string
      path = args[1] as string | RegExp
      middleware = args.slice(2) as RouterMiddleware<S, C>[]
    } else {
      path = args[0] as string | RegExp | (string | RegExp)[]
      middleware = args.slice(1) as RouterMiddleware<S, C>[]
    }

    const route = this.register(path, methodsArray, middleware, { name })
    if (name) route.name = name

    return this
  }
}

export default Router
