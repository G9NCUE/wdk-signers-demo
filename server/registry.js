// Builds one root signer per provider from the environment. A provider whose variables are
// missing is listed as unavailable, with the reason, so the UI can say what is not configured.
import { readFileSync } from 'node:fs'
import { Turnkey } from '@turnkey/sdk-server'
import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import Openfort from '@openfort/openfort-node'
import { BasePath, Fireblocks } from '@fireblocks/ts-sdk'
import { TurnkeySignerEvm } from 'wdk-signer-turnkey-evm'
import { DfnsSignerEvm } from 'wdk-signer-dfns-evm'
import { OpenfortSignerEvm } from 'wdk-signer-openfort-evm'
import { FireblocksSignerEvm } from 'wdk-signer-fireblocks-evm'
import { NETWORKS } from '../src/lib/networks.js'
import { networksOf } from '../src/lib/support.js'

const env = process.env
const need = (...keys) => {
  const missing = keys.filter(k => !env[k])
  if (missing.length) throw new Error(`missing ${missing.join(', ')}`)
}

// id, label, and a build() that returns a root signer or throws with the missing configuration
export const PROVIDERS = [
  {
    id: 'turnkey',
    label: 'Turnkey',
    kind: 'HD wallet, policies on typed payloads',
    build () {
      need('TURNKEY_ORGANIZATION_ID', 'TURNKEY_API_PUBLIC_KEY', 'TURNKEY_API_PRIVATE_KEY', 'TURNKEY_WALLET_ID')
      const client = new Turnkey({
        apiBaseUrl: env.TURNKEY_BASE_URL || 'https://api.turnkey.com',
        apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
        apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
        defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID
      }).apiClient()
      return new TurnkeySignerEvm({ client, walletId: env.TURNKEY_WALLET_ID })
    }
  },
  {
    id: 'dfns',
    label: 'Dfns',
    kind: 'MPC, wallet per derived key',
    // a Dfns wallet is bound to one network, so one root per network, all on the same derived keys
    build (networkId) {
      need('DFNS_AUTH_TOKEN', 'DFNS_CRED_ID', 'DFNS_MASTER_KEY_ID')
      const privateKey = env.DFNS_PRIVATE_KEY ?? readFileSync(mustHave('DFNS_PRIVATE_KEY_FILE'), 'utf8')
      const client = new DfnsApiClient({
        baseUrl: env.DFNS_API_URL || 'https://api.dfns.io',
        authToken: env.DFNS_AUTH_TOKEN,
        signer: new AsymmetricKeySigner({ credId: env.DFNS_CRED_ID, privateKey })
      })
      const network = networkId ? NETWORKS[networkId].dfnsNetwork : (env.DFNS_NETWORK || 'EthereumSepolia')
      return new DfnsSignerEvm({ client, masterKeyId: env.DFNS_MASTER_KEY_ID, network })
    }
  },
  {
    id: 'openfort',
    label: 'Openfort',
    kind: 'TEE backend wallet, one key',
    build () {
      need('OPENFORT_SECRET_KEY', 'OPENFORT_WALLET_SECRET', 'OPENFORT_ACCOUNT_ID')
      const openfort = new Openfort(env.OPENFORT_SECRET_KEY, { walletSecret: env.OPENFORT_WALLET_SECRET })
      return new OpenfortSignerEvm({ backend: openfort.accounts.evm.backend, accountId: env.OPENFORT_ACCOUNT_ID })
    }
  },
  {
    id: 'fireblocks',
    label: 'Fireblocks',
    kind: 'MPC vault account, RAW signing',
    build () {
      need('FIREBLOCKS_API_KEY', 'FIREBLOCKS_SECRET_KEY_FILE', 'FIREBLOCKS_VAULT_ACCOUNT_ID')
      const basePaths = { sandbox: BasePath.Sandbox, us: BasePath.US, eu: BasePath.EU, eu2: BasePath.EU2 }
      const client = new Fireblocks({
        apiKey: env.FIREBLOCKS_API_KEY,
        secretKey: readFileSync(env.FIREBLOCKS_SECRET_KEY_FILE, 'utf8'),
        basePath: basePaths[env.FIREBLOCKS_BASE_PATH || 'sandbox']
      })
      return new FireblocksSignerEvm({ client, vaultAccountId: env.FIREBLOCKS_VAULT_ACCOUNT_ID, assetId: env.FIREBLOCKS_ASSET_ID || 'ETH_TEST5' })
    }
  }
]

function mustHave (key) {
  need(key)
  return env[key]
}

// one entry per provider: `root` is the default network's root, `roots` one per supported network
// (the same object when the provider's key is chain-agnostic), children keyed by network and path
export function buildRegistry () {
  const registry = new Map()
  for (const p of PROVIDERS) {
    try {
      const networks = networksOf(p.id)
      const roots = {}
      const perNetwork = p.build.length > 0
      const shared = perNetwork ? null : p.build()
      for (const id of networks) roots[id] = perNetwork ? p.build(id) : shared
      const root = roots[networks[0]]
      registry.set(p.id, { ...p, root, roots, networks, children: new Map(), available: true, reason: null })
    } catch (e) {
      registry.set(p.id, { ...p, root: null, roots: {}, networks: networksOf(p.id), children: new Map(), available: false, reason: e.message })
    }
  }
  return registry
}
