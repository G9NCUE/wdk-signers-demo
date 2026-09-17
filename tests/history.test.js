// history() merges Blockscout and the WDK indexer; fetch is stubbed with the shapes both APIs return.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { history } from '../server/history.js'

const ME = '0x0aE315a925dab605F29dEC534213496646C8c7D5'
const OTHER = '0x260dED86Fe1E6a0dB51aDB0De837201A9FF41452'

const blockscout = {
  items: [
    { hash: '0xa1', from: { hash: ME.toLowerCase() }, to: { hash: OTHER.toLowerCase() }, value: '5000000000000000', timestamp: '2026-09-11T05:08:12.000000Z', status: 'ok', fee: { value: '26011388109000' }, block_number: 11679783, method: null },
    { hash: '0xa2', from: { hash: OTHER }, to: { hash: ME }, value: '62000000000000000', timestamp: '2026-09-10T09:28:00.000000Z', status: 'ok', fee: { value: '1' }, block_number: 11670000, method: null },
    { hash: '0xa3', from: { hash: ME }, to: { hash: ME }, value: '100000000000000', timestamp: '2026-09-10T09:33:00.000000Z', status: 'error', fee: { value: '1' }, block_number: 11670100, method: null }
  ]
}
// 2026-09-10T12:00:00Z, between the two ETH transactions of the 10th and the one of the 11th
const indexer = { transfers: [{ transactionHash: '0xb1', from: OTHER.toLowerCase(), to: ME.toLowerCase(), amount: '12.5', timestamp: 1789041600, blockNumber: 11675000, transferIndex: 0 }] }

const realFetch = globalThis.fetch
let calls
beforeEach(() => {
  calls = []
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), headers: opts?.headers })
    if (String(url).includes('blockscout')) return new Response(JSON.stringify(blockscout), { status: 200 })
    if (String(url).includes('wdk-api')) return new Response(JSON.stringify(indexer), { status: 200 })
    return new Response('{}', { status: 404 })
  }
})
afterEach(() => { globalThis.fetch = realFetch; delete process.env.WDK_INDEXER_API_KEY })

test('ETH and USDT entries are merged newest first with direction and amounts', async () => {
  process.env.WDK_INDEXER_API_KEY = 'k'
  const h = await history(ME.toLowerCase(), { network: 'sepolia' })
  assert.equal(h.address, ME)
  assert.deepEqual(h.sources, { blockscout: 'ok', wdkIndexer: 'ok' })
  assert.deepEqual(h.entries.map(e => [e.kind, e.direction, e.amount]), [
    ['ETH', 'out', '0.005'], ['USDT', 'in', '12.5'], ['ETH', 'self', '0.0001'], ['ETH', 'in', '0.062']
  ])
  assert.equal(h.entries[0].counterparty, OTHER)
  assert.equal(h.entries[2].status, 'failed')
  assert.match(h.entries[1].link, /etherscan\.io\/tx\/0xb1$/)
  assert.equal(calls.find(c => c.url.includes('wdk-api')).headers['x-api-key'], 'k')
  assert.match(calls.find(c => c.url.includes('wdk-api')).url, /\/api\/v1\/sepolia\/usdt\/0x0aE3.*\/token-transfers\?limit=20$/)
})

test('without an indexer key the ETH half still comes and the footer says why', async () => {
  const h = await history(ME, { network: 'sepolia' })
  assert.equal(h.entries.filter(e => e.kind === 'USDT').length, 0)
  assert.equal(h.entries.length, 3)
  assert.match(h.sources.wdkIndexer, /no key/)
  assert.ok(!calls.some(c => c.url.includes('wdk-api')))
})

test('an address Blockscout never saw is an empty history, not an error', async () => {
  globalThis.fetch = async () => new Response('{"message":"Not found"}', { status: 404 })
  const h = await history(OTHER, { network: 'sepolia' })
  assert.deepEqual(h.entries, [])
  assert.equal(h.sources.blockscout, 'ok')
})

test('limit caps the merged list', async () => {
  process.env.WDK_INDEXER_API_KEY = 'k'
  const h = await history(ME, { limit: 2, network: 'sepolia' })
  assert.equal(h.entries.length, 2)
})

test('a pending transaction has no timestamp yet, sorts first and is not marked failed', async () => {
  const pending = { hash: '0xp1', from: { hash: ME }, to: { hash: OTHER }, value: '1000000000000000', timestamp: null, status: null, fee: null, block_number: null, method: null }
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).includes('blockscout') ? { items: [pending, ...blockscout.items] } : indexer), { status: 200 })
  const h = await history(ME, { network: 'sepolia' })
  assert.equal(h.entries[0].hash, '0xp1')
  assert.equal(h.entries[0].status, 'pending')
  assert.equal(h.entries[0].timestamp, null)
  assert.equal(h.entries[1].hash, '0xa1')
})

test('a bad address is rejected', async () => {
  await assert.rejects(history('0x123'), /bad address|invalid/i)
})

test('the default network is Arbitrum, with USDT0 labels and Arbiscan links', async () => {
  process.env.WDK_INDEXER_API_KEY = 'k'
  const h = await history(ME)
  assert.ok(calls.some(c => c.url.startsWith('https://arbitrum.blockscout.com/')))
  assert.ok(calls.some(c => c.url.includes('/api/v1/arbitrum/usdt/')))
  assert.equal(h.entries.find(e => e.source === 'wdk-indexer').kind, 'USDT0')
  assert.match(h.entries[0].link, /^https:\/\/arbiscan\.io\/tx\//)
})

test('a Blockscout failure is reported in the footer, the USDT half still comes', async () => {
  process.env.WDK_INDEXER_API_KEY = 'k'
  globalThis.fetch = async (url) => String(url).includes('blockscout') ? new Response('boom', { status: 500 }) : new Response(JSON.stringify(indexer), { status: 200 })
  const h = await history(ME, { network: 'arbitrum' })
  assert.equal(h.sources.blockscout, 'HTTP 500')
  assert.deepEqual(h.entries.map(e => e.kind), ['USDT0'], 'the token is named per network')
  assert.match(h.entries[0].link, /arbiscan\.io/)
})

test('an unknown network is refused before any call', async () => {
  await assert.rejects(history(ME, { network: 'polygon' }), /unknown network polygon/)
  assert.equal(calls.length, 0)
})
