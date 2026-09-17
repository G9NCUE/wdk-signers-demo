// Which networks each signer can sign on in this demo. Browser and service keys are chain-agnostic;
// Dfns wallets and Fireblocks vault assets are bound to one network by the service's .env.
// Shared by the catalog (the picker) and the live tests (one flow per signer per network).
export const SIGNER_NETWORKS = {
  seed: ['sepolia', 'arbitrum'],
  ledger: ['sepolia', 'arbitrum'],
  metamask: ['sepolia', 'arbitrum'],
  turnkey: ['sepolia', 'arbitrum'],
  openfort: ['sepolia', 'arbitrum'],
  dfns: ['sepolia'],
  fireblocks: ['sepolia']
}

export const networksOf = (signerId) => SIGNER_NETWORKS[signerId] ?? ['sepolia']
