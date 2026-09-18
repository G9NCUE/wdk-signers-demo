// The networks the phone can switch between. Shared by the browser and the service (history).
// Gasless: the WDK's 7702 module over Candide's public bundler and paymaster, gas paid in the token.
const USDT0_ARBITRUM = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'

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
    safe: null,
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
    tokens: [{ symbol: 'USDT0', address: USDT0_ARBITRUM, decimals: 6 }],
    primary: 'USDT0', // the balance the card leads with; the native coin otherwise
    gasless: {
      bundlerUrl: 'https://api.candide.dev/public/v3/42161',
      // EntryPoint v0.8 and its reference delegate, the module's default. Candide's public Arbitrum
      // bundler rejected v0.8 sends on 2026-09-17 (their bug, fixed the same day in voltaire #79, verified
      // on the 18th); v0.9 with 0xa46cc63eBF4Bd77888AA327837d20b23A63a56B5 works too
      delegationAddress: '0xe6Cae83BdE06E4c305530e199D7217f42808555B',
      entryPointVersion: '0.8',
      paymasterToken: { address: USDT0_ARBITRUM, symbol: 'USDT0', decimals: 6 }
    },
    // the Safe 2-of-3: Safe modules v0.2.0 on EntryPoint v0.6, gas paid in USDT0 through Candide's
    // v0.6 token paymaster (verified 2026-09-17, deployment included in the first user operation)
    safe: {
      bundlerUrl: 'https://api.candide.dev/public/v3/42161',
      paymasterAddress: '0x36f4aa64673568782461bf03c75462f8ef0a1b76',
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
