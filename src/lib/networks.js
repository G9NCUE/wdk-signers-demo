// The networks the phone can switch between. Shared by the browser and the service (history).
// Gasless: the WDK's 7702 module over Candide's public bundler and paymaster, gas paid in the token.
export const USDT0_ARBITRUM = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'

export const NETWORKS = {
  sepolia: {
    id: 'sepolia',
    label: 'Sepolia',
    chainId: 11155111,
    testnet: true,
    native: 'ETH',
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    blockscout: 'https://eth-sepolia.blockscout.com',
    indexer: 'sepolia', // WDK indexer slug
    tokens: [],
    gasless: null,
    fireblocksAsset: 'ETH_TEST5',
    dfnsNetwork: 'EthereumSepolia'
  },
  arbitrum: {
    id: 'arbitrum',
    label: 'Arbitrum One',
    chainId: 42161,
    testnet: false,
    native: 'ETH',
    rpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
    blockscout: 'https://arbitrum.blockscout.com',
    indexer: 'arbitrum',
    tokens: [{ symbol: 'USDT0', address: USDT0_ARBITRUM, decimals: 6, indexer: 'usdt' }],
    gasless: {
      bundlerUrl: 'https://api.candide.dev/public/v3/42161',
      delegationAddress: '0xe6Cae83BdE06E4c305530e199D7217f42808555B', // EntryPoint v0.8 reference implementation
      entryPointVersion: '0.8',
      paymasterToken: { address: USDT0_ARBITRUM, symbol: 'USDT0', decimals: 6 }
    },
    fireblocksAsset: 'ETH-AETH',
    dfnsNetwork: 'ArbitrumOne'
  }
}

// mainnet by default; the testnet sits behind the toggle in the top bar
export const DEFAULT_NETWORK = 'arbitrum'
export const DEFAULT_TESTNET = 'sepolia'

export const networksFor = (testnet) => Object.values(NETWORKS).filter(n => n.testnet === testnet)

export function networkOf (id) {
  const n = NETWORKS[id]
  if (!n) throw new Error(`unknown network ${id}`)
  return n
}
