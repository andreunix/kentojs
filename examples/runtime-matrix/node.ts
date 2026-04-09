import { listenNode } from 'kento'
import { createRuntimeMatrixApp } from './app.ts'

const port = Number(process.env.PORT ?? 3002)
const server = await listenNode(createRuntimeMatrixApp(), {
  port,
  hostname: '127.0.0.1',
  env: {
    ...process.env,
    RUNTIME: 'node'
  }
})

console.log(`Runtime matrix (node) listening on ${server.origin}`)
