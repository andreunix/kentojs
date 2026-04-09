import assert from 'node:assert/strict'
import type { KentoPlatform } from '../../../packages/core/src/index.ts'
import { createMultiRuntimeApp, createRuntimePlatform } from '../../fixtures/apps/multi-runtime-app.ts'

export async function runAppFetchContract(
  runtimeName: string,
  createPlatform?: () => KentoPlatform
): Promise<void> {
  const app = createMultiRuntimeApp()
  const platform = createPlatform?.() ?? createRuntimePlatform(runtimeName, '127.0.0.1')

  const root = await app.fetch(new Request('http://localhost/'), platform)
  assert.equal(root.status, 200)
  assert.equal(root.headers.get('x-frame-options'), 'SAMEORIGIN')
  assert.equal(root.headers.get('access-control-allow-origin'), 'https://client.example')
  assert.deepEqual(await root.json(), {
    ok: true,
    runtime: runtimeName
  })

  const showUser = await app.fetch(
    new Request('http://localhost/users/42?tag=a&tag=b', {
      headers: {
        'X-Forwarded-For': '203.0.113.10'
      }
    }),
    platform
  )
  assert.equal(showUser.status, 200)
  assert.deepEqual(await showUser.json(), {
    userId: '42',
    query: { tag: ['a', 'b'] },
    ip: '203.0.113.10',
    runtime: runtimeName
  })

  const echo = await app.fetch(
    new Request('http://localhost/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ hello: runtimeName })
    }),
    platform
  )
  assert.equal(echo.status, 200)
  assert.deepEqual(await echo.json(), {
    received: { hello: runtimeName }
  })

  const preflight = await app.fetch(
    new Request('http://localhost/echo', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://client.example',
        'Access-Control-Request-Method': 'POST'
      }
    }),
    platform
  )
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://client.example')
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET,HEAD,PUT,POST,DELETE,PATCH')
}
