// One-time: finds or creates the vault account the demo signs with, adds the Sepolia asset, and
// prints the .env line. Needs FIREBLOCKS_API_KEY and FIREBLOCKS_SECRET_KEY_FILE in .env (the API user
// must have the Signer role). Run: node --env-file=.env server/setup-fireblocks.mjs
import { readFileSync } from 'node:fs'
import { BasePath, Fireblocks } from '@fireblocks/ts-sdk'

const need = (k) => process.env[k] ?? (() => { throw new Error(`${k} is not set in .env`) })()
const NAME = process.env.FIREBLOCKS_VAULT_NAME || 'wdk-signers-demo'
const ASSET = process.env.FIREBLOCKS_ASSET_ID || 'ETH_TEST5'
const basePaths = { sandbox: BasePath.Sandbox, us: BasePath.US, eu: BasePath.EU, eu2: BasePath.EU2 }

const fb = new Fireblocks({
  apiKey: need('FIREBLOCKS_API_KEY'),
  secretKey: readFileSync(need('FIREBLOCKS_SECRET_KEY_FILE'), 'utf8'),
  basePath: basePaths[process.env.FIREBLOCKS_BASE_PATH || 'sandbox']
})

// the API user works: list what the workspace already has
const { data: paged } = await fb.vaults.getPagedVaultAccounts({ namePrefix: NAME })
let vault = (paged.accounts ?? []).find(a => a.name === NAME)
if (vault) {
  console.log(`vault account "${NAME}" exists: id ${vault.id}`)
} else {
  vault = (await fb.vaults.createVaultAccount({ createVaultAccountRequest: { name: NAME } })).data
  console.log(`created vault account "${NAME}": id ${vault.id}`)
}

// one address per account-based asset; creating it again is refused, so look first
const has = (vault.assets ?? []).some(a => a.id === ASSET)
if (!has) {
  const { data } = await fb.vaults.createVaultAccountAsset({ vaultAccountId: vault.id, assetId: ASSET })
  console.log(`added ${ASSET}: ${data.address}`)
}
const { data: addresses } = await fb.vaults.getVaultAccountAssetAddressesPaginated({ vaultAccountId: vault.id, assetId: ASSET })
const address = addresses.addresses?.[0]?.address
console.log(`${ASSET} address: ${address}`)

console.log(`\nadd to .env:\nFIREBLOCKS_VAULT_ACCOUNT_ID=${vault.id}`)
console.log('\nthen fund the address with Sepolia ETH, restart npm run dev, and run: node server/probe.js fireblocks')
