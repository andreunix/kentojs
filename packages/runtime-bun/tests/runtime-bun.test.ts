import { describe, expect, it } from 'bun:test'
import { BunRuntimeApp, createBunRuntime } from '../src'

function createApp() {
  return createBunRuntime({ silent: true })
}

describe('@kento/runtime-bun', () => {
  it('forwards platform.clientAddress into request.ip', async () => {
    const runtime = createApp()

    runtime.use(async (ctx) => {
      ctx.body = { ip: ctx.ip }
    })

    const response = await runtime.fetch(new Request('http://localhost/'), {
      clientAddress: '203.0.113.7'
    })

    expect(await response.json()).toEqual({ ip: '203.0.113.7' })
  })

  it('listens through Bun.serve and closes the active server', async () => {
    let capturedFetch: ((req: Request, server: any) => Response | Promise<Response>) | undefined
    let stopCount = 0

    const runtime = new BunRuntimeApp(createApp().app, {
      serve(options) {
        capturedFetch = options.fetch as typeof capturedFetch
        return {
          requestIP() {
            return { address: '198.51.100.10' }
          },
          stop() {
            stopCount += 1
          }
        } as any
      }
    })

    const server = runtime.listen({ port: 3333, hostname: '127.0.0.1' })

    expect(server).toBeTruthy()
    expect(typeof capturedFetch).toBe('function')

    runtime.use(async (ctx) => {
      ctx.body = { ip: ctx.ip }
    })

    const response = await capturedFetch?.(new Request('http://localhost/'), {
      requestIP() {
        return { address: '198.51.100.10' }
      }
    })

    expect(await response?.json()).toEqual({ ip: '198.51.100.10' })

    runtime.close()
    expect(stopCount).toBe(1)
  })
})
