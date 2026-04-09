import Kento, {
  Router,
  bodyParser,
  cors,
  helmet,
  type KentoPlatform,
} from 'kento'
import type { RouterContext } from 'kento'

export function createFetchHandlerApp() {
  const app = new Kento({ proxy: true, silent: true })
  const router = new Router()

  app.use(helmet())
  app.use(cors({ origin: '*' }))
  app.use(bodyParser({ enableTypes: ['json', 'form'] }))

  router.get('/', (ctx: RouterContext) => {
    ctx.body = {
      ok: true,
      runtime: ctx.platform.name ?? 'portable',
      query: ctx.query
    }
  })

  router.post('/echo', (ctx: RouterContext) => {
    ctx.body = {
      received: (ctx.request as any).body ?? null,
      runtime: ctx.platform.name ?? 'portable'
    }
  })

  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}

export const app = createFetchHandlerApp()

export function handleRequest(request: Request, platform?: KentoPlatform) {
  return app.fetch(request, platform)
}

if (import.meta.main) {
  const response = await handleRequest(
    new Request('http://localhost/?source=fetch-handler'),
    {
      name: 'example',
      clientAddress: '127.0.0.1'
    }
  )

  console.log(await response.text())
}
