import { Application, type KentoPlatform } from '../../../packages/core/src/index.ts'
import { Router, type RouterContext } from '../../../packages/router/src/index.ts'
import { bodyParser } from '../../../packages/bodyparser/src/index.ts'
import { cors } from '../../../packages/cors/src/index.ts'
import { helmet } from '../../../packages/helmet/src/index.ts'

export function createMultiRuntimeApp(): Application {
  const app = new Application({ proxy: true, silent: true })
  const router = new Router()

  app.use(helmet())
  app.use(cors({
    origin: 'https://client.example',
    credentials: true,
    keepHeadersOnError: true
  }))
  app.use(bodyParser({ enableTypes: ['json', 'form'] }))

  router.get('/', (ctx: RouterContext) => {
    ctx.body = {
      ok: true,
      runtime: ctx.platform.env?.RUNTIME ?? 'unknown'
    }
  })

  router.get('/users/:id', (ctx: RouterContext) => {
    ctx.body = {
      userId: ctx.params.id,
      query: ctx.query,
      ip: ctx.ip,
      runtime: ctx.platform.env?.RUNTIME ?? 'unknown'
    }
  })

  router.post('/echo', (ctx: RouterContext) => {
    ctx.body = {
      received: (ctx.request as any).body ?? null
    }
  })

  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}

export function createRuntimePlatform(name: string, clientAddress: string): KentoPlatform {
  return {
    name,
    clientAddress,
    env: {
      RUNTIME: name
    }
  }
}
