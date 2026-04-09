import test from 'node:test'
import { listen } from '../../../packages/runtime-node/src/index.ts'
import { createMultiRuntimeApp } from '../../fixtures/apps/multi-runtime-app.ts'
import { runHttpIntegration } from '../shared/http-integration.ts'

test('http integration (node)', async () => {
  const port = 36000 + Math.floor(Math.random() * 1000)

  await runHttpIntegration(async () => {
    const server = await listen(createMultiRuntimeApp(), {
      port,
      hostname: '127.0.0.1',
      env: { RUNTIME: 'integration' }
    })

    return {
      origin: server.origin,
      close() {
        return server.close()
      }
    }
  })
})
