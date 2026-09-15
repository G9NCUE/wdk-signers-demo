// One-time: creates (or finds) the EVM backend wallet the demo signs with, and prints the .env line.
// Needs OPENFORT_SECRET_KEY and OPENFORT_WALLET_SECRET in .env. Run: node --env-file=.env server/setup-openfort.mjs
import Openfort from '@openfort/openfort-node'

const need = (k) => process.env[k] ?? (() => { throw new Error(`${k} is not set in .env`) })()
const openfort = new Openfort(need('OPENFORT_SECRET_KEY'), { walletSecret: need('OPENFORT_WALLET_SECRET') })
const backend = openfort.accounts.evm.backend

if (process.env.OPENFORT_ACCOUNT_ID) {
  const account = await backend.get({ id: process.env.OPENFORT_ACCOUNT_ID })
  console.log(`OPENFORT_ACCOUNT_ID is set: ${account.id} ${account.address}`)
  process.exit(0)
}

const existing = await backend.list({ limit: 10 }).catch(() => null)
const accounts = existing?.accounts ?? existing?.data ?? []
if (accounts.length) {
  console.log('backend wallets already in this project:')
  for (const a of accounts) console.log(`  ${a.id}  ${a.address}`)
  console.log(`\nadd to .env:\nOPENFORT_ACCOUNT_ID=${accounts[0].id}`)
} else {
  const account = await backend.create()
  console.log(`created ${account.id} ${account.address}\n\nadd to .env:\nOPENFORT_ACCOUNT_ID=${account.id}`)
}
console.log('\nthen fund the address with Sepolia ETH for the send, restart npm run dev, and run: node server/probe.js openfort')
