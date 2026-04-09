import { describe, it } from 'bun:test'
import { listen } from '../../../packages/runtime-bun/src/index.ts'
import { createMultiRuntimeApp } from '../../fixtures/apps/multi-runtime-app.ts'
import { runHttpIntegration } from '../shared/http-integration.ts'

describe('http integration (bun)', () => {
  it('serves the shared app through the Bun adapter', async () => {
    const port = 35000 + Math.floor(Math.random() * 1000)

    await runHttpIntegration(async () => {
      const server = listen(createMultiRuntimeApp(), {
        port,
        hostname: '127.0.0.1',
        env: { RUNTIME: 'integration' }
      })

      return {
        origin: server.origin,
        close() {
          server.close()
        }
      }
    })
  })
})
