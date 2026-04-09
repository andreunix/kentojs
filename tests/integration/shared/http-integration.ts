import assert from 'node:assert/strict'

export interface IntegrationServerHandle {
  origin: string
  close(): Promise<void> | void
}

export async function runHttpIntegration(
  start: () => Promise<IntegrationServerHandle>
): Promise<void> {
  const server = await start()

  try {
    const root = await fetch(`${server.origin}/`)
    assert.equal(root.status, 200)
    assert.equal(root.headers.get('x-frame-options'), 'SAMEORIGIN')
    assert.deepEqual(await root.json(), {
      ok: true,
      runtime: 'integration'
    })

    const echo = await fetch(`${server.origin}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ source: 'integration' })
    })
    assert.equal(echo.status, 200)
    assert.deepEqual(await echo.json(), {
      received: { source: 'integration' }
    })

    const preflight = await fetch(`${server.origin}/echo`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://client.example',
        'Access-Control-Request-Method': 'POST'
      }
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://client.example')
  } finally {
    await server.close()
  }
}
