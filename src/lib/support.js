// Which networks each signer can sign on in this demo. Browser, Turnkey and Openfort keys are
// chain-agnostic; Dfns gets one wallet per network on the same key; Fireblocks vault assets are per
// network and the sandbox only has testnets.
// Shared by the catalog (the picker) and the live tests (one flow per signer per network).
const SIGNER_NETWORKS = {
  seed: ['sepolia', 'arbitrum'],
  ledger: ['sepolia', 'arbitrum'],
  metamask: ['sepolia', 'arbitrum'],
  turnkey: ['sepolia', 'arbitrum'],
  openfort: ['sepolia', 'arbitrum'],
  dfns: ['sepolia', 'arbitrum'], // one Dfns wallet per network, on the same derived keys
  fireblocks: ['sepolia'] // the sandbox refuses mainnet assets (testMode), a real workspace would add arbitrum
}

export const networksOf = (signerId) => SIGNER_NETWORKS[signerId] ?? ['sepolia']
