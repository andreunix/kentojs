import { describe, it, expect } from 'bun:test'
import { compose } from '../src/compose'

describe('compose', () => {
  it('should work with empty middleware', async () => {
    const fn = compose([])
    await fn({} as any)
  })

  it('should execute middleware in order', async () => {
    const order: number[] = []
    const fn = compose([
      async (_ctx, next) => { order.push(1); await next(); order.push(4) },
      async (_ctx, next) => { order.push(2); await next(); order.push(3) },
    ])
    await fn({} as any)
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('should pass context through', async () => {
    const ctx = { value: 0 } as any
    const fn = compose([
      async (ctx: any, next) => { ctx.value = 1; await next() },
      async (ctx: any, next) => { ctx.value = 2; await next() },
    ])
    await fn(ctx)
    expect(ctx.value).toBe(2)
  })

  it('should throw if middleware is not an array', () => {
    expect(() => compose('not an array' as any)).toThrow('array')
  })

  it('should throw if middleware contains non-function', () => {
    expect(() => compose([42 as any])).toThrow('function')
  })

  it('should throw on double next() call', async () => {
    const fn = compose([
      async (_ctx, next) => { await next(); await next() },
    ])
    await expect(fn({} as any)).rejects.toThrow('next() called multiple times')
  })

  it('should stop at middleware that doesnt call next', async () => {
    const order: number[] = []
    const fn = compose([
      async (_ctx, _next) => { order.push(1) },
      async (_ctx, _next) => { order.push(2) },
    ])
    await fn({} as any)
    expect(order).toEqual([1])
  })

  it('should propagate errors', async () => {
    const fn = compose([
      async (_ctx, next) => { await next() },
      async () => { throw new Error('test error') },
    ])
    await expect(fn({} as any)).rejects.toThrow('test error')
  })
})
