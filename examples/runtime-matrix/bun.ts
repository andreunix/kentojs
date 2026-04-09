import { createRuntimeMatrixApp } from './app.ts'

const port = Number(process.env.PORT ?? 3001)
const app = createRuntimeMatrixApp()
const server = await app.listen({ port, runtime: 'bun' })

console.log(`Runtime matrix (bun) listening on ${server.origin}`)
