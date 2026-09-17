import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { WalletAccountEvm7702Gasless } from '@tetherto/wdk-wallet-evm-7702-gasless'
import { JsonRpcProvider, Transaction, formatEther, formatUnits, parseEther, parseUnits, verifyMessage } from 'ethers'
import { DEFAULT_NETWORK, networkOf } from './networks.js'

export { parseEther, parseUnits, formatUnits }

// Sepolia keeps its env override (VITE_ under Vite, plain under Node), the other networks use the
// public RPC of networks.js
const SEPOLIA_OVERRIDE = import.meta.env?.VITE_SEPOLIA_RPC_URL || globalThis.process?.env?.SEPOLIA_RPC_URL
export const rpcOf = (net) => (net.id === 'sepolia' && SEPOLIA_OVERRIDE) || net.rpc
export const CHAIN_ID = networkOf(DEFAULT_NETWORK).chainId
const ACCOUNT_COUNT = 3

// the well-known test mnemonic, never funded: a manager needs a derivable default signer, so a
// single-key signer is registered by name behind it (the WDK's own pattern for private-key
// signers), and the Safe owner shim builds its throwaway owner on it
export const THROWAWAY_SEED = 'test test test test test test test test test test test junk'

export function createWallet (signer, networkId = DEFAULT_NETWORK) {
  const net = networkOf(networkId)
  const config = { provider: rpcOf(net), chainId: net.chainId }
  if (signer.isDerivable) return { wallet: new WalletManagerEvm(signer, config), named: null, signer, net }
  const wallet = new WalletManagerEvm(THROWAWAY_SEED, config)
  wallet.addSigner('remote', signer)
  return { wallet, named: 'remote', signer, net }
}

// history comes from the service: Blockscout for ETH, the WDK indexer for USDT
export async function loadHistory (address, limit = 20, networkId = DEFAULT_NETWORK) {
  const res = await fetch(`/api/history/${address}?limit=${limit}&network=${networkId}`)
  if (!res.ok) throw new Error(`history: HTTP ${res.status}`)
  return res.json()
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
export async function loadAccounts ({ wallet, named }, count = ACCOUNT_COUNT) {
  const accounts = named
    ? [await wallet.getAccount(named)]
    : await Promise.all(Array.from({ length: count }, (_, i) => wallet.getAccount(i)))
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

// the network's tokens, as { symbol, address, decimals, balance } with the balance formatted
export async function tokenBalancesOf (account, net) {
  return Promise.all(net.tokens.map(async (t) => {
    try { return { ...t, balance: formatUnits(await account.getTokenBalance(t.address), t.decimals) } } catch (e) { return { ...t, balance: `error: ${e.message}` } }
  }))
}

// the 7702 gasless account on top of a WDK account: gas paid in the network's token through the
// bundler and paymaster of networks.js. Needs signAuthorization on the signer, so not MetaMask.
// the wrapper is not disposed on purpose: its dispose() disposes the wrapped account, which belongs
// to the wallet; it holds no key of its own
export function gaslessOf (account, net) {
  if (!net.gasless) throw new Error(`${net.label} has no gasless configuration in this demo.`)
  const gl = new WalletAccountEvm7702Gasless(account, {
    provider: rpcOf(net),
    chainId: net.chainId,
    bundlerUrl: net.gasless.bundlerUrl,
    delegationAddress: net.gasless.delegationAddress,
    entryPointVersion: net.gasless.entryPointVersion,
    paymasterToken: { address: net.gasless.paymasterToken.address }
  })
  // the module recognises an account by `instanceof WalletAccountEvm`; with two copies of the class
  // in a bundle it rebuilds the owner from our account as if it were a seed and signs with nothing
  if (gl._ownerAccount !== account) throw new Error('the 7702 module did not keep the account (two copies of WalletAccountEvm in the bundle); signing would go to an empty seed signer')
  return gl
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
  async signTransaction (account, signer, { net } = {}) {
    const network = net ?? networkOf(DEFAULT_NETWORK)
    const address = await account.getAddress()
    const provider = new JsonRpcProvider(rpcOf(network), network.chainId, { staticNetwork: true })
    const [nonce, fees] = await Promise.all([provider.getTransactionCount(address), provider.getFeeData()])
    const unsigned = {
      type: 2, chainId: network.chainId, nonce, to: address, value: 0n, data: '0x', gasLimit: 21000n,
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

  // a real transfer to another account the demo controls. Three routes: the native coin through the
  // WDK (or the wallet's own path for an injected wallet), a token through WalletAccountEvm.transfer,
  // or a token through the 7702 gasless account with gas paid in the token itself.
  async send (account, signer, { to, value, toLabel, asset, gasless, net }) {
    const network = net ?? networkOf(DEFAULT_NETWORK)
    const address = await account.getAddress()
    if (!(value > 0n)) throw new Error('The amount must be above zero.')
    if (to.toLowerCase() === address.toLowerCase()) throw new Error('Pick another account than the sender.')
    const explorer = network.explorer

    if (asset && asset.address) {
      const options = { token: asset.address, recipient: to, amount: value }
      const human = `${formatUnits(value, asset.decimals)} ${asset.symbol}`
      if (gasless) {
        const gl = gaslessOf(account, network)
        let hash, fee
        try {
          ({ hash, fee } = await gl.transfer(options))
        } catch (e) {
          const cause = e.cause ? String(e.cause) : ''
          if (/token balance lower/i.test(cause)) throw new Error(`the paymaster takes its fee in ${asset.symbol} and this account does not hold enough ${asset.symbol} for the amount plus the fee (${cause})`)
          throw e
        }
        return {
          ok: true,
          text: `sent ${human} to ${toLabel} gasless, user operation ${hash}`,
          link: `${explorer}/address/${address}`,
          details: { from: address, ...options, toLabel, userOperationHash: hash, feeInToken: fee, via: '7702 gasless, gas paid in the token through the paymaster', bundler: network.gasless.bundlerUrl, explorer: `${explorer}/address/${address}` }
        }
      }
      const { hash, fee } = await account.transfer(options)
      return {
        ok: true,
        text: `sent ${human} to ${toLabel}, ${hash}`,
        link: `${explorer}/tx/${hash}`,
        details: { from: address, ...options, toLabel, hash, fee, via: 'WalletAccountEvm.transfer, gas in the native coin', explorer: `${explorer}/tx/${hash}` }
      }
    }

    const request = { to, value, data: '0x' }
    const { hash, fee } = typeof signer?.sendTransaction === 'function'
      ? await signer.sendTransaction(request)
      : await account.sendTransaction(request)
    return {
      ok: true,
      text: `sent ${formatEther(value)} ${network.native} to ${toLabel}, ${hash}`,
      link: `${explorer}/tx/${hash}`,
      details: { from: address, ...request, toLabel, hash, fee, via: signer?.sendTransaction ? 'the wallet (eth_sendTransaction)' : 'WDK sendTransaction, eth_sendRawTransaction', explorer: `${explorer}/tx/${hash}` }
    }
  }
}

// details go to the log as text, bigints and nested objects included
export function formatDetails (details) {
  return JSON.stringify(details, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
}
