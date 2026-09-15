// The other accounts the demo controls, as send targets. Seed accounts are computed here, remote
// signers' accounts resolved once through the service, Ledger and MetaMask only once connected in
// this session (they prompt), remembered from the accounts the app loaded.
import { createWallet, loadAccounts } from './wallet.js'

const resolved = new Map() // signer id -> [{ index, address }]
const seen = new Map() // what the app connected in this session, same shape

export function remember (signerId, accounts) {
  seen.set(signerId, accounts.map(a => ({ index: a.index, address: a.address })))
}

// resolves without prompting: browser signers that need a device or an extension are skipped
async function resolve (entry) {
  if (resolved.has(entry.id)) return resolved.get(entry.id)
  if (seen.has(entry.id)) return seen.get(entry.id)
  if (!entry.available || entry.prompts) return []
  const signer = await entry.build()
  const handle = createWallet(signer)
  try {
    const list = await loadAccounts(handle, entry.isDerivable === false ? 1 : 2)
    const out = list.map(a => ({ index: a.index, address: a.address }))
    resolved.set(entry.id, out)
    return out
  } finally {
    handle.wallet.dispose()
  }
}

export async function recipients (signers, { exclude } = {}) {
  const groups = await Promise.all(signers.map(async (s) => {
    try {
      return { id: s.id, label: s.label, key: s.key, accounts: await resolve(s), error: null }
    } catch (e) {
      return { id: s.id, label: s.label, key: s.key, accounts: [], error: e.message }
    }
  }))
  return groups
    .map(g => ({ ...g, accounts: g.accounts.filter(a => a.address.toLowerCase() !== exclude?.toLowerCase()) }))
    .filter(g => g.accounts.length || g.error)
}
