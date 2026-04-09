import { createRuntimeMatrixApp } from './app.ts'

const port = Number(process.env.PORT ?? 3002)
const app = createRuntimeMatrixApp()
const server = await app.listen({ port, hostname: '127.0.0.1' }) // runtime: 'node' é o padrão

console.log(`Runtime matrix (node) listening on ${server.origin}`)
