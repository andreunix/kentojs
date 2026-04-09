import { listenBun } from 'kento'
import { createRuntimeMatrixApp } from './app.ts'

const port = Number(process.env.PORT ?? 3001)
const server = listenBun(createRuntimeMatrixApp(), {
  port,
  env: {
    RUNTIME: 'bun'
  }
})

console.log(`Runtime matrix (bun) listening on ${server.origin}`)
