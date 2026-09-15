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

// Sepolia only. The phrase stays in this browser's localStorage, it is a throwaway.
function localMnemonic () {
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
    kind: 'in the browser, WDK SeedSignerEvm',
    where: 'browser',
    key: 'local',
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
    available: Eip1193SignerEvm.isAvailable(globalThis),
    reason: 'no injected wallet found, install MetaMask, Rabby or Coinbase Wallet',
    isDerivable: false,
    // the wallet signs and broadcasts itself, it never returns a signed transaction
    can: { signTransaction: false, signAuthorization: false },
    build: async () => new Eip1193SignerEvm({ provider: globalThis.ethereum, chainId: CHAIN_ID })
  }
]

export async function loadRemoteSigners () {
  const res = await fetch('/api/signers')
  if (!res.ok) throw new Error(`signer service: HTTP ${res.status}`)
  const list = await res.json()
  return list.map(s => ({
    ...s,
    where: 'service',
    key: 'remote',
    can: FULL,
    build: async () => new RemoteSignerEvm({ id: s.id, path: s.path, isDerivable: s.isDerivable })
  }))
}
