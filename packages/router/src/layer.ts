import { pathToRegexp, compile, parse } from './path.ts'
import type { PathKey } from './path.ts'
import type {
  LayerOptions,
  RouterMiddleware,
  RouterParameterMiddleware,
  DefaultState,
  DefaultContext,
  RouterContext,
  Next
} from './types.ts'

type ParameterMiddleware<S = DefaultState, C = DefaultContext> = RouterMiddleware<S, C> & {
  param?: string
  _originalFn?: RouterParameterMiddleware<S, C>
}

export class Layer<S = DefaultState, C = DefaultContext> {
  opts: LayerOptions
  name: string | undefined
  methods: string[]
  paramNames: PathKey[]
  stack: RouterMiddleware<S, C>[]
  path: string | RegExp
  regexp!: RegExp

  constructor(
    path: string | RegExp,
    methods: string[],
    middleware: RouterMiddleware<S, C> | RouterMiddleware<S, C>[],
    options: LayerOptions = {}
  ) {
    this.opts = options
    this.name = options.name
    this.methods = []
    this.paramNames = []
    this.path = path

    const middlewareArray = Array.isArray(middleware) ? middleware : [middleware]
    for (const fn of middlewareArray) {
      if (typeof fn !== 'function') {
        throw new Error(`${methods}: middleware must be a function, not ${typeof fn}`)
      }
    }
    this.stack = middlewareArray

    for (const method of methods) {
      const upper = method.toUpperCase()
      this.methods.push(upper)
      if (upper === 'GET') this.methods.unshift('HEAD')
    }

    this._compileRegexp()
  }

  private _compileRegexp(): void {
    if (this.path instanceof RegExp) {
      this.regexp = this.path
      return
    }

    const result = pathToRegexp(this.path, {
      trailing: !(this.opts.strict ?? false),
      end: this.opts.end !== false
    })
    this.regexp = result.regexp
    this.paramNames = result.keys
  }

  match(path: string): boolean {
    return this.regexp.test(path)
  }

  captures(path: string): string[] {
    if (this.opts.ignoreCaptures) return []
    const m = path.match(this.regexp)
    return m ? m.slice(1) : []
  }

  params(
    _path: string,
    captures: string[],
    existing: Record<string, string> = {}
  ): Record<string, string> {
    const result = { ...existing }
    for (const [i, capture] of captures.entries()) {
      const key = this.paramNames[i]
      if (key && capture) {
        try {
          result[String(key.name)] = decodeURIComponent(capture)
        } catch {
          result[String(key.name)] = capture
        }
      }
    }
    return result
  }

  url(...args: unknown[]): string {
    if (this.path instanceof RegExp) {
      throw new TypeError('Cannot generate URL for RegExp paths.')
    }

    let params: Record<string, unknown> | unknown[] = {}
    let query: Record<string, unknown> | string | undefined

    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const obj = args[0] as Record<string, unknown>
      if ('query' in obj && Object.keys(obj).length === 1) {
        query = obj.query as Record<string, unknown> | string
      } else if ('query' in obj) {
        const { query: q, ...rest } = obj
        query = q as Record<string, unknown> | string
        params = rest
      } else {
        params = obj
      }
    } else if (args.length >= 1) {
      params = args as unknown[]
    }

    const pathStr = (this.path as string).replace(/\(\.\*\)/g, '')
    const toPath = compile(pathStr, { encode: encodeURIComponent })
    const paramReplacements: Record<string, string> = {}

    if (Array.isArray(params)) {
      const { tokens } = parse(pathStr)
      let idx = 0
      for (const token of tokens) {
        if (token.type === 'param' && token.name) {
          paramReplacements[token.name] = String((params as unknown[])[idx++] ?? '')
        }
      }
    } else {
      for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
        paramReplacements[k] = String(v)
      }
    }

    let generatedUrl = toPath(paramReplacements)

    if (query) {
      if (typeof query === 'string') {
        generatedUrl += query.startsWith('?') ? query : `?${query}`
      } else {
        const qs = new URLSearchParams(query as Record<string, string>).toString()
        if (qs) generatedUrl += `?${qs}`
      }
    }

    return generatedUrl
  }

  param(paramName: string, handler: RouterParameterMiddleware<S, C>): this {
    const paramNames = this.paramNames.map(k => String(k.name))
    const pos = paramNames.indexOf(paramName)
    if (pos === -1) return this

    const mw: ParameterMiddleware<S, C> = ((ctx: RouterContext<S, C>, next: Next) => {
      if (!(ctx as any)._matchedParams) (ctx as any)._matchedParams = new WeakMap()
      if ((ctx as any)._matchedParams.has(handler)) return next()
      ;(ctx as any)._matchedParams.set(handler, true)
      return handler(ctx.params[paramName] ?? '', ctx, next)
    }) as ParameterMiddleware<S, C>

    mw.param = paramName
    mw._originalFn = handler

    let inserted = false
    for (let i = 0; i < this.stack.length; i++) {
      const existing = this.stack[i] as ParameterMiddleware<S, C>
      if (!existing.param) {
        this.stack.splice(i, 0, mw); inserted = true; break
      }
      if (paramNames.indexOf(existing.param) > pos) {
        this.stack.splice(i, 0, mw); inserted = true; break
      }
    }
    if (!inserted) this.stack.push(mw)
    return this
  }

  setPrefix(prefix: string): this {
    if (!this.path || this.path instanceof RegExp) return this
    this.path = this.path === '/' && !this.opts.strict
      ? prefix
      : `${prefix}${this.path}`
    this._compileRegexp()
    return this
  }
}

export default Layer
