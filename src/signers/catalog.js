// The signers the app can switch between. Two run in the browser (seed, Ledger), the others
// live in the local service and are reached through RemoteSignerEvm.
import { Mnemonic, randomBytes } from 'ethers'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import { LedgerSignerEvm, createWebHidDmk } from 'wdk-signer-ledger-evm'
import RemoteSignerEvm from './remote-signer-evm.js'

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
    available: true,
    isDerivable: true,
    build: async () => new SeedSignerEvm(localMnemonic()),
    detail: () => localMnemonic()
  },
  {
    id: 'ledger',
    label: 'Ledger',
    kind: 'hardware, WebHID, wdk-signer-ledger-evm',
    where: 'browser',
    available: typeof navigator !== 'undefined' && 'hid' in navigator,
    reason: 'WebHID is not available in this browser, use Chrome or Edge',
    isDerivable: true,
    build: async () => new LedgerSignerEvm({ dmk: await createWebHidDmk() })
  }
]

export async function loadRemoteSigners () {
  const res = await fetch('/api/signers')
  if (!res.ok) throw new Error(`signer service: HTTP ${res.status}`)
  const list = await res.json()
  return list.map(s => ({
    ...s,
    where: 'service',
    build: async () => new RemoteSignerEvm({ id: s.id, path: s.path, isDerivable: s.isDerivable })
  }))
}
