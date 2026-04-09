import test from 'node:test'
import { runAppFetchContract } from '../shared/app-contract.ts'

test('app.fetch contract (node)', async () => {
  await runAppFetchContract('node')
})
