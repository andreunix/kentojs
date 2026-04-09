import Kento, { Router, cors, bodyParser, helmet, compress, rateLimit, loggerMiddleware } from './src/index'
import type { RouterContext } from '@kento/router'

const app = new Kento({ proxy: true })
const router = new Router()
const logger = Kento.createLogger({ level: 'info' })
app.use(helmet())
app.use(cors({ origin: '*' }))
app.use(compress({ threshold: 512 }))
app.use(rateLimit({ driver: 'memory', max: 100, duration: 60_000 }))
app.use(bodyParser({ enableTypes: ['json', 'form'] }))
app.use(loggerMiddleware(logger))

router.get('/', (ctx: RouterContext) => {
  ctx.body = { message: 'Hello from Kento!', version: '0.1.0' }
})

router.get('/users/:id', (ctx: RouterContext) => {
  ctx.body = { userId: ctx.params.id }
})

router.post('/echo', (ctx: RouterContext) => {
  ctx.body = { received: (ctx.request as any).body }
})

app.use(router.routes())
app.use(router.allowedMethods())

const server = app.listen(3000)
console.log(`Kento running on http://localhost:${server.port}`)
