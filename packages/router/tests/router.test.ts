import { describe, it, expect } from 'bun:test'
import { Application } from '@kento/core'
import { Router } from '../src/router'
import type { RouterContext } from '../src/types'

function createApp() {
  return new Application({ silent: true })
}

async function request(app: Application, path = '/', opts: RequestInit = {}): Promise<Response> {
  const handle = app.callback()
  const server = {
    requestIP() {
      return { address: '127.0.0.1' }
    }
  } as any

  return handle(new Request(`http://localhost${path}`, opts), server)
}

describe('Router', () => {
  it('should route GET requests', async () => {
    const app = createApp()
    const router = new Router()
    router.get('/hello', async (ctx: RouterContext) => { ctx.body = 'world' })
    app.use(router.routes())
    const res = await request(app, '/hello')
    expect(await res.text()).toBe('world')
  })

  it('should route POST requests', async () => {
    const app = createApp()
    const router = new Router()
    router.post('/data', async (ctx: RouterContext) => { ctx.body = 'received' })
    app.use(router.routes())
    const res = await request(app, '/data', { method: 'POST' })
    expect(await res.text()).toBe('received')
  })

  it('should extract path parameters', async () => {
    const app = createApp()
    const router = new Router()
    router.get('/users/:id', async (ctx: RouterContext) => {
      ctx.body = { id: ctx.params.id }
    })
    app.use(router.routes())
    const res = await request(app, '/users/42')
    expect(await res.json()).toEqual({ id: '42' })
  })

  it('should handle multiple path parameters', async () => {
    const app = createApp()
    const router = new Router()
    router.get('/users/:userId/posts/:postId', async (ctx: RouterContext) => {
      ctx.body = { userId: ctx.params.userId, postId: ctx.params.postId }
    })
    app.use(router.routes())
    const res = await request(app, '/users/1/posts/99')
    expect(await res.json()).toEqual({ userId: '1', postId: '99' })
  })

  it('should return 404 for unmatched routes', async () => {
    const app = createApp()
    const router = new Router()
    router.get('/exists', async (ctx: RouterContext) => { ctx.body = 'found' })
    app.use(router.routes())
    const res = await request(app, '/not-exists')
    expect(res.status).toBe(404)
  })

  it('should handle method not allowed (405)', async () => {
    const app = createApp()
    const router = new Router()
    router.get('/only-get', async (ctx: RouterContext) => { ctx.body = 'ok' })
    app.use(router.routes())
    app.use(router.allowedMethods())
    const res = await request(app, '/only-get', { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('should support named routes', async () => {
    const router = new Router()
    router.get('user', '/users/:id', async () => {})
    const url = router.url('user', { id: '42' })
    expect(url).toContain('/users/42')
  })

  it('should support prefix', async () => {
    const app = createApp()
    const router = new Router({ prefix: '/api' })
    router.get('/users', async (ctx: RouterContext) => { ctx.body = 'users' })
    app.use(router.routes())
    const res = await request(app, '/api/users')
    expect(await res.text()).toBe('users')
  })

  it('should support nested routers', async () => {
    const app = createApp()
    const outer = new Router()
    const inner = new Router()
    inner.get('/items', async (ctx: RouterContext) => { ctx.body = 'items' })
    outer.use('/api', inner.routes())
    app.use(outer.routes())
    const res = await request(app, '/api/items')
    expect(await res.text()).toBe('items')
  })

  it('should support all() for any method', async () => {
    const app = createApp()
    const router = new Router()
    router.all('/any', async (ctx: RouterContext) => { ctx.body = ctx.method })
    app.use(router.routes())

    const getRes = await request(app, '/any')
    expect(await getRes.text()).toBe('GET')
  })

  it('should support redirect', async () => {
    const app = createApp()
    const router = new Router()
    router.redirect('/old', '/new')
    app.use(router.routes())
    const res = await request(app, '/old', { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toContain('/new')
  })

  it('should decode URL-encoded parameters', async () => {
    const app = createApp()
    const router = new Router()
    router.get('/search/:term', async (ctx: RouterContext) => {
      ctx.body = { term: ctx.params.term }
    })
    app.use(router.routes())
    const res = await request(app, '/search/hello%20world')
    expect(await res.json()).toEqual({ term: 'hello world' })
  })

  it('should handle OPTIONS requests with allowedMethods', async () => {
    const app = createApp()
    const router = new Router()
    router.get('/resource', async (ctx: RouterContext) => { ctx.body = 'ok' })
    router.post('/resource', async (ctx: RouterContext) => { ctx.body = 'ok' })
    app.use(router.routes())
    app.use(router.allowedMethods())
    const res = await request(app, '/resource', { method: 'OPTIONS' })
    expect(res.status).toBe(200)
    expect(res.headers.get('allow')).toBeTruthy()
  })

  it('should support middleware on routes', async () => {
    const app = createApp()
    const router = new Router()
    const auth = async (ctx: RouterContext, next: any) => {
      ctx.state.authed = true
      await next()
    }
    router.get('/protected', auth, async (ctx: RouterContext) => {
      ctx.body = { authed: ctx.state.authed }
    })
    app.use(router.routes())
    const res = await request(app, '/protected')
    expect(await res.json()).toEqual({ authed: true })
  })

  it('should support param middleware', async () => {
    const app = createApp()
    const router = new Router()
    router.param('id', async (id: string, ctx: RouterContext, next: any) => {
      ctx.state.userId = parseInt(id)
      await next()
    })
    router.get('/users/:id', async (ctx: RouterContext) => {
      ctx.body = { userId: ctx.state.userId }
    })
    app.use(router.routes())
    const res = await request(app, '/users/42')
    expect(await res.json()).toEqual({ userId: 42 })
  })

  it('should apply parent param middleware to nested routers', async () => {
    const app = createApp()
    const parent = new Router()
    const child = new Router()

    parent.param('userId', async (id: string, ctx: RouterContext, next: any) => {
      ctx.state.userId = parseInt(id)
      await next()
    })

    child.get('/posts', async (ctx: RouterContext) => {
      ctx.body = { userId: ctx.state.userId, params: ctx.params }
    })

    parent.use('/users/:userId', child.routes())
    app.use(parent.routes())

    const res = await request(app, '/users/42/posts')
    expect(await res.json()).toEqual({
      userId: 42,
      params: { userId: '42' }
    })
  })
})
