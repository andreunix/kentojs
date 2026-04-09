import { describe, it } from 'bun:test'
import { runAppFetchContract } from '../shared/app-contract.ts'

describe('app.fetch contract (bun)', () => {
  it('matches the shared fixture', async () => {
    await runAppFetchContract('bun')
  })
})
