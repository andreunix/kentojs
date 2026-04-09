import type { ParameterizedContext, Next, DefaultState, DefaultContext } from '@kento/core'

export type { DefaultState, DefaultContext, Next }

export interface RouterOptions {
  methods?: string[]
  prefix?: string
  strict?: boolean
  sensitive?: boolean
  exclusive?: boolean
  host?: string | string[] | RegExp
}

export interface LayerOptions {
  name?: string
  strict?: boolean
  sensitive?: boolean
  ignoreCaptures?: boolean
  end?: boolean
}

export type RouterMiddleware<S = DefaultState, C = DefaultContext> = (
  ctx: RouterContext<S, C>,
  next: Next
) => Promise<void> | void

export type RouterContext<S = DefaultState, C = DefaultContext> = ParameterizedContext<S, C> & {
  params: Record<string, string>
  captures: string[]
  router: import('./router.ts').Router<S, C>
  routerPath: string
  routerName?: string
  _matchedRoute?: string | RegExp
  _matchedRouteName?: string
}

export type RouterParameterMiddleware<S = DefaultState, C = DefaultContext> = (
  param: string,
  ctx: RouterContext<S, C>,
  next: Next
) => Promise<void> | void
