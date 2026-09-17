// What the page reads about the Safe without an account: its balances, whether it is deployed, and
// the receipt of a user operation from the bundler once it is mined.
import { Contract, JsonRpcProvider, formatEther, formatUnits } from 'ethers'
import { rpcOf } from '../wallet.js'

const ERC20 = ['function balanceOf(address) view returns (uint256)']
const providers = new Map()
const providerOf = (net) => {
  if (!providers.has(net.id)) providers.set(net.id, new JsonRpcProvider(rpcOf(net), net.chainId, { staticNetwork: true }))
  return providers.get(net.id)
}

export async function balancesOf (address, net) {
  const provider = providerOf(net)
  const [wei, code, ...tokens] = await Promise.all([
    provider.getBalance(address),
    provider.getCode(address),
    ...net.tokens.map(t => new Contract(t.address, ERC20, provider).balanceOf(address)
      .then(b => ({ ...t, balance: formatUnits(b, t.decimals) }))
      .catch(e => ({ ...t, balance: `error: ${e.message}` })))
  ])
  return { native: formatEther(wei), deployed: code !== '0x', tokens }
}

// null until the bundler has included the operation
export async function userOperationReceipt (bundlerUrl, hash) {
  const res = await fetch(bundlerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getUserOperationReceipt', params: [hash] })
  })
  const { result, error } = await res.json()
  if (error) throw new Error(error.message ?? String(error))
  if (!result) return null
  return { txHash: result.receipt?.transactionHash ?? null, success: result.success, actualGasCost: result.actualGasCost ?? null, blockNumber: result.receipt?.blockNumber ?? null }
}
