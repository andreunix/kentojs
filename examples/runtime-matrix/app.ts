import Kento, {
  Router,
  bodyParser,
  cors,
  helmet,
} from 'kento'
import type { RouterContext } from 'kento'

export function createRuntimeMatrixApp() {
  const app = new Kento({ proxy: true })
  const router = new Router()

  app.use(helmet())
  app.use(cors({ origin: '*' }))
  app.use(bodyParser({ enableTypes: ['json', 'form'] }))

  router.get('/', (ctx: RouterContext) => {
    ctx.body = {
      ok: true,
      runtime: ctx.platform.env?.RUNTIME ?? 'unknown'
    }
  })

  router.post('/echo', (ctx: RouterContext) => {
    ctx.body = {
      received: true,
      runtime: ctx.platform.env?.RUNTIME ?? 'unknown'
    }
  })

  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}
