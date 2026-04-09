<p align="center">
  <img src="./.github/assets/wolf.svg" alt="kentojs wolf logo" width="220" />
</p>

<h1 align="center">kentojs</h1>

<p align="center">
  Modern TypeScript web framework built on the Web Fetch API.
</p>

<p align="center">
  Runtime-agnostic. Middleware-first. Dark by design.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kento"><img src="https://img.shields.io/npm/v/kento?style=flat-square&color=black" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/kento"><img src="https://img.shields.io/npm/dm/kento?style=flat-square&color=black" alt="npm downloads" /></a>
  <img src="https://img.shields.io/badge/runtime-bun%20%7C%20node-black?style=flat-square" alt="runtimes" />
  <img src="https://img.shields.io/badge/license-MIT-black?style=flat-square" alt="license" />
</p>

---

kentojs is a web framework for developers who want a cleaner foundation for backend applications.

Built around standard `Request` and `Response`, it keeps application code close to the Web Platform and away from runtime-specific server primitives. The middleware model is Koa-inspired — a simple `async (ctx, next) => {}` pipeline — with full TypeScript support throughout.

Designed for **Bun** and **Node.js**, with zero changes needed between runtimes.

---

<p align="center">
  <strong>Write for the platform, not the runtime.</strong>
</p>

---

## Table of contents

- [Packages](#packages)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Runtime adapters](#runtime-adapters)
- [Middleware](#middleware)
  - [Router](#router)
  - [Body parser](#body-parser)
  - [CORS](#cors)
  - [Helmet](#helmet)
  - [Compression](#compression)
  - [Rate limit](#rate-limit)
  - [Logger](#logger)
- [Security](#security)
- [Development](#development)
- [Project structure](#project-structure)
- [License](#license)

---

## Packages

kentojs ships as a focused monorepo. Install only what you need, or pull everything through the `kento` meta-package.

| Package | Description |
|---|---|
| [`@kento/core`](packages/core) | Application, context, middleware compose, request/response |
| [`@kento/router`](packages/router) | Express-style router with named params, prefix and `allowedMethods` |
| [`@kento/bodyparser`](packages/bodyparser) | JSON, form, text and XML body parsing with enforced size limits |
| [`@kento/cors`](packages/cors) | CORS middleware with dynamic origin and credentials support |
| [`@kento/helmet`](packages/helmet) | Security headers — CSP, HSTS, X-Frame-Options and more |
| [`@kento/compress`](packages/compress) | Brotli / gzip / deflate response compression |
| [`@kento/ratelimit`](packages/ratelimit) | In-memory rate limiting with pluggable key and whitelist |
| [`@kento/logger`](packages/logger) | Structured logger with JSON and pretty formatters, pluggable transports |
| [`@kento/runtime-bun`](packages/runtime-bun) | `Bun.serve` adapter |
| [`@kento/runtime-node`](packages/runtime-node) | Node.js `http.createServer` adapter |
| [`kento`](packages/kento) | Meta-package — re-exports all of the above |

---

## Installation

```bash
# Bun
bun add kento

# npm
npm install kento
```

---

## Quick start

```ts
import Kento, {
  Router,
  cors,
  bodyParser,
  helmet,
  compress,
  rateLimit,
  loggerMiddleware,
  listenBun,
} from 'kento'
import type { RouterContext } from 'kento'

const app = new Kento({ proxy: true })
const router = new Router()
const logger = Kento.createLogger({ level: 'debug' })

app.use(helmet())
app.use(cors({ origin: '*' }))
app.use(compress({ threshold: 512 }))
app.use(rateLimit({ driver: 'memory', max: 100, duration: 60_000 }))
app.use(bodyParser({ enableTypes: ['json', 'form'] }))
app.use(loggerMiddleware(logger))

router.get('/', (ctx: RouterContext) => {
  ctx.body = { message: 'Hello from kentojs!' }
})

router.get('/users/:id', (ctx: RouterContext) => {
  ctx.body = { userId: ctx.params.id }
})

router.post('/echo', (ctx: RouterContext) => {
  ctx.body = { received: (ctx.request as any).body }
})

app.use(router.routes())
app.use(router.allowedMethods())

listenBun(app, { port: 3000 })
```

---

## Runtime adapters

### Bun

```ts
import { listenBun } from 'kento'

listenBun(app, { port: 3000 })
```

### Node.js

```ts
import { listenNode } from 'kento'

listenNode(app, { port: 3000, trustProxy: true })
```

### Portable fetch handler

The application exposes a standard `fetch` method. No adapter required for edge runtimes, serverless environments, or tests:

```ts
const response = await app.fetch(new Request('http://localhost/'))
```

---

## Middleware

### Router

```ts
import { Router } from 'kento'
import type { RouterContext } from 'kento'

const router = new Router({ prefix: '/api' })

router.get('/hello', (ctx: RouterContext) => {
  ctx.body = 'hello'
})

router.post('/items', async (ctx: RouterContext) => {
  ctx.status = 201
  ctx.body = (ctx.request as any).body
})

// Named parameters
router.get('/users/:id/posts/:postId', (ctx: RouterContext) => {
  const { id, postId } = ctx.params
  ctx.body = { id, postId }
})

app.use(router.routes())
app.use(router.allowedMethods())
```

### Body parser

```ts
import { bodyParser } from 'kento'

app.use(bodyParser({
  enableTypes: ['json', 'form', 'text'],
  jsonLimit: '1mb',
  formLimit: '256kb',
}))

router.post('/data', (ctx) => {
  const body = (ctx.request as any).body // already parsed
})
```

Limits are enforced **during streaming** — the parser aborts as soon as the configured byte ceiling is exceeded, regardless of `Content-Length`.

### CORS

```ts
import { cors } from 'kento'

// Static origin
app.use(cors({ origin: 'https://myapp.example.com', credentials: true }))

// Dynamic origin
app.use(cors({
  origin: (ctx) => ctx.get('Origin') ?? '',
  credentials: true,
}))
```

### Helmet

```ts
import { helmet } from 'kento'

// Secure defaults out of the box
app.use(helmet())

// Custom CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", 'cdn.example.com'],
    },
  },
}))
```

### Compression

```ts
import { compress } from 'kento'

// Automatically selects brotli, gzip or deflate from Accept-Encoding
app.use(compress({ threshold: 1024 }))
```

### Rate limit

```ts
import { rateLimit } from 'kento'

app.use(rateLimit({
  driver: 'memory',
  max: 100,
  duration: 60_000, // 1-minute window
  id: (ctx) => ctx.ip ?? 'anon',
  whitelist: (ctx) => ctx.path === '/healthz',
}))
```

### Logger

```ts
import { createLogger, loggerMiddleware } from 'kento'

const logger = createLogger({ name: 'api', level: 'info' })

// Child logger with extra bindings
const authLogger = logger.child({ service: 'auth' })
authLogger.info({ userId: 42 }, 'user signed in')

// Request logging middleware
app.use(loggerMiddleware(logger))
```

---

## Security

kentojs is built with an explicit security model:

**Proxy trust is explicit.**
`X-Forwarded-Proto` and `X-Forwarded-For` are only honoured when `trustProxy: true` is set on the runtime adapter. Untrusted headers cannot spoof request authority or protocol.

**Body limits are enforced during streaming.**
The parser reads the request body incrementally and aborts with `413` as soon as the limit is reached — even when `Content-Length` is absent or deliberately understated.

**Redirects are strict.**
`ctx.redirect()` blocks protocol-relative URLs (`//evil.example`), backslash-based bypasses (`\/`, `\\`), and non-http(s) schemes (`javascript:`, `data:`). Only relative paths and explicit `https://` / `http://` URLs are accepted.

**Security headers by default.**
The `helmet()` middleware sets Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Origin-Agent-Cluster, Referrer-Policy, and more — all in a single `app.use()`.

---

## Development

```bash
# All tests — unit, contract and integration (Bun + Node)
bun run test:all

# Unit tests only
bun test

# Type-check all packages
bun run typecheck:all

# Run the hello-world example on Bun
bun run example:hello

# Run the runtime-matrix example on Node.js
bun run example:runtime:node
```

---

## Project structure

```
packages/
  core/            Application, context, request, response, compose
  router/          HTTP router
  bodyparser/      Body parsing
  cors/            CORS
  helmet/          Security headers
  compress/        Response compression
  ratelimit/       Rate limiting
  logger/          Structured logging
  runtime-bun/     Bun adapter
  runtime-node/    Node.js adapter
  kento/           Meta-package
examples/
  hello-world.ts   Full stack example (Bun)
  fetch-handler.ts Portable fetch handler example
tests/
  contracts/       Runtime contract tests (Bun + Node)
  integration/     HTTP integration tests (Bun + Node)
```

---

## License

MIT