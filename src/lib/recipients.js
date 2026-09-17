// The other accounts the demo controls, as send targets. Seed accounts are computed here, remote
// signers' accounts resolved once per network through the service, Ledger and MetaMask only once
// connected in this session (they prompt), remembered from the accounts the app loaded.
import { createWallet, loadAccounts } from './wallet.js'

const resolved = new Map() // "signer:network" -> [{ index, address }]
const seen = new Map() // what the app connected in this session, same shape and key

export function remember (signerId, accounts, networkId) {
  seen.set(`${signerId}:${networkId}`, accounts.map(a => ({ index: a.index, address: a.address })))
}

// resolves without prompting: browser signers that need a device or an extension are skipped
async function resolve (entry, net) {
  const key = `${entry.id}:${net.id}`
  if (resolved.has(key)) return resolved.get(key)
  if (seen.has(key)) return seen.get(key)
  if (!entry.available || entry.prompts) return []
  const signer = await entry.build(net)
  const handle = createWallet(signer, net.id)
  try {
    const list = await loadAccounts(handle, entry.isDerivable === false ? 1 : 2)
    const out = list.map(a => ({ index: a.index, address: a.address }))
    resolved.set(key, out)
    return out
  } finally {
    handle.wallet.dispose()
  }
}

export async function recipients (signers, { net, exclude } = {}) {
  const groups = await Promise.all(signers.map(async (s) => {
    try {
      return { id: s.id, label: s.label, key: s.key, accounts: await resolve(s, net), error: null }
    } catch (e) {
      return { id: s.id, label: s.label, key: s.key, accounts: [], error: e.message }
    }
  }))
  return groups
    .map(g => ({ ...g, accounts: g.accounts.filter(a => a.address.toLowerCase() !== exclude?.toLowerCase()) }))
    .filter(g => g.accounts.length || g.error)
}

// for tests: forget what was resolved
export function forgetRecipients () {
  resolved.clear()
  seen.clear()
}
