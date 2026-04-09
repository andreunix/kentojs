import { describe, it, expect } from 'bun:test'
import { pathToRegexp, compile, parse } from '../src/path'

describe('pathToRegexp', () => {
  it('should match literal paths', () => {
    const { regexp } = pathToRegexp('/users')
    expect(regexp.test('/users')).toBe(true)
    expect(regexp.test('/users/')).toBe(true) // trailing slash
    expect(regexp.test('/other')).toBe(false)
  })

  it('should capture named parameters', () => {
    const { regexp, keys } = pathToRegexp('/users/:id')
    expect(keys).toHaveLength(1)
    expect(keys[0]!.name).toBe('id')
    const m = '/users/42'.match(regexp)
    expect(m).toBeTruthy()
    expect(m![1]).toBe('42')
  })

  it('should capture multiple parameters', () => {
    const { regexp, keys } = pathToRegexp('/users/:userId/posts/:postId')
    expect(keys).toHaveLength(2)
    const m = '/users/1/posts/99'.match(regexp)
    expect(m).toBeTruthy()
    expect(m![1]).toBe('1')
    expect(m![2]).toBe('99')
  })

  it('should handle rest parameters with +', () => {
    const { regexp, keys } = pathToRegexp('/files/:path+')
    expect(keys[0]!.name).toBe('path')
    const m = '/files/a/b/c'.match(regexp)
    expect(m).toBeTruthy()
    expect(m![1]).toBe('a/b/c')
  })

  it('should handle wildcard (*)', () => {
    const { regexp } = pathToRegexp('/api/(.*)')
    expect(regexp.test('/api/anything/here')).toBe(true)
  })

  it('should respect end:false for prefix matching', () => {
    const { regexp } = pathToRegexp('/api', { end: false })
    expect(regexp.test('/api/users')).toBe(true)
    expect(regexp.test('/api')).toBe(true)
  })

  it('should respect strict mode (no trailing)', () => {
    const { regexp } = pathToRegexp('/users', { trailing: false })
    expect(regexp.test('/users')).toBe(true)
    expect(regexp.test('/users/')).toBe(false)
  })
})

describe('compile', () => {
  it('should compile path with parameters', () => {
    const toPath = compile('/users/:id')
    expect(toPath({ id: '42' })).toBe('/users/42')
  })

  it('should encode parameter values', () => {
    const toPath = compile('/search/:query')
    const result = toPath({ query: 'hello world' })
    expect(result).toContain('hello%20world')
  })
})

describe('parse', () => {
  it('should parse tokens', () => {
    const { tokens } = parse('/users/:id/posts')
    expect(tokens.length).toBe(3)
    expect(tokens[0]).toEqual({ type: 'text', value: '/users/' })
    expect(tokens[1]).toEqual({ type: 'param', value: ':id', name: 'id' })
    expect(tokens[2]).toEqual({ type: 'text', value: '/posts' })
  })
})
