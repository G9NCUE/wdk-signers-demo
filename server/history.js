// Transaction history for one Sepolia address, from two sources merged by time:
// - native ETH transactions from Blockscout's public API (no key);
// - USDT transfers from the WDK indexer (https://wdk-api.tether.io, key in .env), the WDK's own
//   history feature, which covers token transfers only: no native ETH history there.
import { formatEther, getAddress } from 'ethers'

const BLOCKSCOUT = process.env.BLOCKSCOUT_URL || 'https://eth-sepolia.blockscout.com'
const INDEXER = process.env.WDK_INDEXER_URL || 'https://wdk-api.tether.io'
const EXPLORER = 'https://sepolia.etherscan.io'

export async function history (address, { limit = 20 } = {}) {
  const me = getAddress(address)
  const [eth, usdt] = await Promise.all([nativeFrom(me, limit), tokenFrom(me, limit)])
  // pending transactions have no timestamp yet and go first
  const entries = [...eth.entries, ...usdt.entries]
    .sort((a, b) => (b.timestamp ?? '~').localeCompare(a.timestamp ?? '~'))
    .slice(0, limit)
  return { address: me, entries, sources: { blockscout: eth.status, wdkIndexer: usdt.status } }
}

async function nativeFrom (me, limit) {
  try {
    const res = await fetch(`${BLOCKSCOUT}/api/v2/addresses/${me}/transactions`)
    if (res.status === 404) return { status: 'ok', entries: [] } // unknown address, never seen on chain
    if (!res.ok) return { status: `HTTP ${res.status}`, entries: [] }
    const { items = [] } = await res.json()
    return {
      status: 'ok',
      entries: items.slice(0, limit).map(tx => {
        const from = getAddress(tx.from.hash)
        const to = tx.to?.hash ? getAddress(tx.to.hash) : null
        return {
          id: `eth:${tx.hash}`,
          hash: tx.hash,
          kind: 'ETH',
          direction: direction(me, from, to),
          amount: formatEther(tx.value),
          counterparty: from === me ? to : from,
          // a transaction still in the mempool has no timestamp, no block and no status
          timestamp: tx.timestamp ?? null,
          block: tx.block_number ?? null,
          status: tx.status === 'ok' ? 'ok' : tx.status ? 'failed' : 'pending',
          fee: tx.fee?.value ? formatEther(tx.fee.value) : null,
          method: tx.method,
          source: 'blockscout',
          link: `${EXPLORER}/tx/${tx.hash}`
        }
      })
    }
  } catch (e) {
    return { status: e.message, entries: [] }
  }
}

async function tokenFrom (me, limit) {
  const apiKey = process.env.WDK_INDEXER_API_KEY
  if (!apiKey) return { status: 'no key, set WDK_INDEXER_API_KEY', entries: [] }
  try {
    const res = await fetch(`${INDEXER}/api/v1/sepolia/usdt/${me}/token-transfers?limit=${limit}`, { headers: { 'x-api-key': apiKey } })
    if (!res.ok) return { status: `HTTP ${res.status}`, entries: [] }
    const { transfers = [] } = await res.json()
    return {
      status: 'ok',
      entries: transfers.map(t => {
        const from = t.from ? getAddress(t.from) : null
        const to = t.to ? getAddress(t.to) : null
        return {
          id: `usdt:${t.transactionHash}:${t.transferIndex ?? t.logIndex ?? 0}`,
          hash: t.transactionHash,
          kind: 'USDT',
          direction: direction(me, from, to),
          amount: String(t.amount),
          counterparty: from === me ? to : from,
          timestamp: new Date(Number(t.timestamp) * (Number(t.timestamp) > 1e12 ? 1 : 1000)).toISOString(),
          block: t.blockNumber,
          status: 'ok',
          source: 'wdk-indexer',
          link: `${EXPLORER}/tx/${t.transactionHash}`
        }
      })
    }
  } catch (e) {
    return { status: e.message, entries: [] }
  }
}

function direction (me, from, to) {
  if (from === me && to === me) return 'self'
  return from === me ? 'out' : 'in'
}
