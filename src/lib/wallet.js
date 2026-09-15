import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { JsonRpcProvider, Transaction, formatEther, verifyMessage } from 'ethers'

export const CHAIN_ID = 11155111
export const RPC_URL = import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
export const EXPLORER = 'https://sepolia.etherscan.io'
const ACCOUNT_COUNT = 3

// a manager needs a derivable default signer, so a single-key signer is registered by name
// behind a throwaway seed, which is the WDK's own pattern for private-key signers
const PLACEHOLDER_SEED = 'test test test test test test test test test test test junk'

export function createWallet (signer) {
  const config = { provider: RPC_URL, chainId: CHAIN_ID }
  if (signer.isDerivable) return { wallet: new WalletManagerEvm(signer, config), named: null }
  const wallet = new WalletManagerEvm(PLACEHOLDER_SEED, config)
  wallet.addSigner('remote', signer)
  return { wallet, named: 'remote' }
}

// accounts 0..2 for a derivable signer, the single account otherwise, addresses resolved
export async function loadAccounts ({ wallet, named }) {
  const accounts = named
    ? [await wallet.getAccount(named)]
    : await Promise.all(Array.from({ length: ACCOUNT_COUNT }, (_, i) => wallet.getAccount(i)))
  return Promise.all(accounts.map(async (account, i) => ({
    account,
    index: named ? account.index : i,
    path: account.path,
    address: await account.getAddress(),
    balance: null
  })))
}

export async function balanceOf (account) {
  return formatEther(await account.getBalance())
}

// the three checks of the demo, each returns a one-line result for the log
export const ACTIONS = {
  async signMessage (account) {
    const message = `wdk signers demo ${new Date().toISOString()}`
    const signature = await account.sign(message)
    const recovered = verifyMessage(message, signature)
    const ok = recovered === await account.getAddress()
    return { ok, text: ok ? `message signed, signature recovers to the account` : `recovered ${recovered}` }
  },

  // account.signTransaction hands the request to the signer as is, only sendTransaction populates
  // it, so the demo fills nonce, fees and chain like an offline signing flow would
  async signTransaction (account) {
    const address = await account.getAddress()
    const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true })
    const [nonce, fees] = await Promise.all([provider.getTransactionCount(address), provider.getFeeData()])
    const signed = await account.signTransaction({
      type: 2, chainId: CHAIN_ID, nonce, to: address, value: 0n, data: '0x', gasLimit: 21000n,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas
    })
    const tx = Transaction.from(signed)
    const ok = tx.from === address
    return { ok, text: ok ? `transaction signed, not sent, ${signed.length / 2 - 1} bytes, from recovers` : `from recovers to ${tx.from}` }
  },

  async sendToSelf (account) {
    const address = await account.getAddress()
    const { hash } = await account.sendTransaction({ to: address, value: 0n, data: '0x' })
    return { ok: true, text: `sent to self, ${hash}`, link: `${EXPLORER}/tx/${hash}` }
  }
}
