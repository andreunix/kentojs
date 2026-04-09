import type { Middleware, Next, ParameterizedContext } from './types'

export function compose<S = object, C = object>(
  middleware: Middleware<S, C>[]
): (ctx: ParameterizedContext<S, C>, next?: Next) => Promise<void> {
  if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!')

  for (const fn of middleware) {
    if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
  }

  return function (ctx, next) {
    let index = -1

    function dispatch(i: number): Promise<void> {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i

      let fn: Middleware<S, C> | undefined = middleware[i]
      if (i === middleware.length) fn = next as Middleware<S, C> | undefined
      if (!fn) return Promise.resolve()

      try {
        return Promise.resolve(fn(ctx, dispatch.bind(null, i + 1) as Next))
      } catch (err) {
        return Promise.reject(err)
      }
    }

    return dispatch(0)
  }
}
