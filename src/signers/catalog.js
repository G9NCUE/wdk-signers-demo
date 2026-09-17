// The signers the app can switch between. Two run in the browser (seed, Ledger), the others
// live in the local service and are reached through RemoteSignerEvm.
import { Mnemonic, randomBytes } from 'ethers'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import { LedgerSignerEvm, createWebHidDmk } from 'wdk-signer-ledger-evm'
import { Eip1193SignerEvm } from 'wdk-signer-eip1193-evm'
import RemoteSignerEvm from './remote-signer-evm.js'
import { CHAIN_ID } from '../lib/wallet.js'

// what a signer cannot do, the UI greys the action out instead of failing it
const FULL = { signTransaction: true, signAuthorization: true }

const MNEMONIC_KEY = 'wdk-signers-demo.mnemonic'

// The demo seed: VITE_DEMO_SEED_PHRASE from .env when set (one seed whatever the port serving the
// app), otherwise a throwaway generated once per browser origin and kept in localStorage.
const ENV_SEED = (import.meta.env?.VITE_DEMO_SEED_PHRASE || '').trim().replace(/\s+/g, ' ')
if (ENV_SEED && !Mnemonic.isValidMnemonic(ENV_SEED)) throw new Error('VITE_DEMO_SEED_PHRASE in .env is not a valid BIP-39 phrase')
export const SEED_SOURCE = ENV_SEED ? '.env' : 'this browser'

function localMnemonic () {
  if (ENV_SEED) return ENV_SEED
  try {
    let phrase = localStorage.getItem(MNEMONIC_KEY)
    if (!phrase) {
      phrase = Mnemonic.entropyToPhrase(randomBytes(16))
      localStorage.setItem(MNEMONIC_KEY, phrase)
    }
    return phrase
  } catch {
    return Mnemonic.entropyToPhrase(randomBytes(16))
  }
}

export const BROWSER_SIGNERS = [
  {
    id: 'seed',
    label: 'Seed phrase',
    kind: `seed from ${SEED_SOURCE}, WDK SeedSignerEvm`,
    where: 'browser',
    key: 'local',
    networks: ['sepolia', 'arbitrum'],
    available: true,
    isDerivable: true,
    can: FULL,
    build: async () => new SeedSignerEvm(localMnemonic()),
    detail: () => localMnemonic()
  },
  {
    id: 'ledger',
    label: 'Ledger',
    kind: 'hardware, WebHID, wdk-signer-ledger-evm',
    where: 'browser',
    key: 'hardware',
    networks: ['sepolia', 'arbitrum'],
    prompts: true, // opens the device picker, never built silently
    available: typeof navigator !== 'undefined' && 'hid' in navigator,
    reason: 'WebHID is not available in this browser, use Chrome or Edge',
    isDerivable: true,
    can: FULL,
    build: async () => new LedgerSignerEvm({ dmk: await createWebHidDmk() })
  },
  {
    id: 'metamask',
    label: 'MetaMask',
    kind: 'injected wallet, EIP-1193, wdk-signer-eip1193-evm',
    where: 'browser',
    key: 'extension',
    networks: ['sepolia', 'arbitrum'],
    prompts: true, // opens the wallet's connect prompt, never built silently
    available: Eip1193SignerEvm.isAvailable(globalThis),
    reason: 'no injected wallet found, install MetaMask, Rabby or Coinbase Wallet',
    isDerivable: false,
    // the wallet signs and broadcasts itself, it never returns a signed transaction
    can: { signTransaction: false, signAuthorization: false },
    build: async (net) => new Eip1193SignerEvm({ provider: globalThis.ethereum, chainId: net?.chainId ?? CHAIN_ID })
  }
]

export async function loadRemoteSigners () {
  const res = await fetch('/api/signers')
  if (!res.ok) throw new Error(`signer service: HTTP ${res.status}`)
  const list = await res.json()
  // Dfns wallets and Fireblocks vault assets are bound to one network in the service's .env,
  // Turnkey and Openfort keys sign for any EVM chain
  const NETWORKS_OF = { turnkey: ['sepolia', 'arbitrum'], openfort: ['sepolia', 'arbitrum'], dfns: ['sepolia'], fireblocks: ['sepolia'] }
  return list.map(s => ({
    ...s,
    where: 'service',
    key: 'remote',
    networks: NETWORKS_OF[s.id] ?? ['sepolia'],
    can: FULL,
    build: async () => new RemoteSignerEvm({ id: s.id, path: s.path, isDerivable: s.isDerivable })
  }))
}
