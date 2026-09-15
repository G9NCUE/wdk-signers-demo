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
  if (signer.isDerivable) return { wallet: new WalletManagerEvm(signer, config), named: null, signer }
  const wallet = new WalletManagerEvm(PLACEHOLDER_SEED, config)
  wallet.addSigner('remote', signer)
  return { wallet, named: 'remote', signer }
}

export function shortAddress (address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''
}

export function shortBalance (balance) {
  if (balance === null || balance === undefined) return null
  if (typeof balance !== 'string' || balance.startsWith('error')) return balance
  const n = Number(balance)
  return n === 0 ? '0' : n < 0.0001 ? '<0.0001' : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
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

// the three checks of the demo, each returns a one-line result for the log and the details behind it
export const ACTIONS = {
  async signMessage (account) {
    const message = `wdk signers demo ${new Date().toISOString()}`
    const signature = await account.sign(message)
    const recovered = verifyMessage(message, signature)
    const address = await account.getAddress()
    const ok = recovered === address
    return {
      ok,
      text: ok ? `message signed, signature recovers to the account` : `recovered ${recovered}`,
      details: { address, message, signature, recovered }
    }
  },

  // account.signTransaction hands the request to the signer as is, only sendTransaction populates
  // it, so the demo fills nonce, fees and chain like an offline signing flow would
  async signTransaction (account) {
    const address = await account.getAddress()
    const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true })
    const [nonce, fees] = await Promise.all([provider.getTransactionCount(address), provider.getFeeData()])
    const unsigned = {
      type: 2, chainId: CHAIN_ID, nonce, to: address, value: 0n, data: '0x', gasLimit: 21000n,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas
    }
    const signed = await account.signTransaction(unsigned)
    const tx = Transaction.from(signed)
    const ok = tx.from === address
    return {
      ok,
      text: ok ? `transaction signed, not sent, ${signed.length / 2 - 1} bytes, from recovers` : `from recovers to ${tx.from}`,
      details: { address, unsigned, signed, recovered: tx.from, hash: tx.hash, signature: tx.signature?.serialized }
    }
  },

  // an injected wallet signs and broadcasts itself, so the send goes through the signer, not the WDK
  async sendToSelf (account, signer) {
    const address = await account.getAddress()
    const request = { to: address, value: 0n, data: '0x' }
    const { hash, fee } = typeof signer?.sendTransaction === 'function'
      ? await signer.sendTransaction(request)
      : await account.sendTransaction(request)
    return {
      ok: true,
      text: `sent to self, ${hash}`,
      link: `${EXPLORER}/tx/${hash}`,
      details: { address, ...request, hash, fee, via: signer?.sendTransaction ? 'the wallet (eth_sendTransaction)' : 'WDK sendTransaction, eth_sendRawTransaction', explorer: `${EXPLORER}/tx/${hash}` }
    }
  }
}

// details go to the log as text, bigints and nested objects included
export function formatDetails (details) {
  return JSON.stringify(details, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
}
