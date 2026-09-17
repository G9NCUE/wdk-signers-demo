// The Safe module's configuration for a network of this demo, and the address a Safe would have.
// Shared by the browser (owner accounts) and the service (prediction at creation time).
import { WalletAccountReadOnlyMultisigEvmSafe4337 } from '@tetherto/wdk-protocol-multisig-safe'
import { getAddress } from 'ethers'
import { rpcOf } from '../wallet.js'
import LocalCoordinator from './local-coordinator.js'

// owners as the module wants them: checksummed, sorted, no duplicates
export function normaliseOwners (owners) {
  const list = [...new Set(owners.map(o => getAddress(o)))].sort()
  if (list.length === 0) throw new Error('a Safe needs at least one owner')
  return list
}

export function safeConfigOf (net, { owners, threshold, saltNonce }, coordinator) {
  if (!net.safe) throw new Error(`${net.label} has no Safe configuration in this demo.`)
  const list = normaliseOwners(owners)
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > list.length) throw new Error(`threshold must be between 1 and ${list.length}`)
  return {
    provider: rpcOf(net),
    chainId: BigInt(net.chainId),
    bundlerUrl: net.safe.bundlerUrl,
    paymasterUrl: net.safe.bundlerUrl,
    paymasterAddress: net.safe.paymasterAddress,
    paymasterTokenAddress: net.safe.paymasterToken.address,
    coordinator,
    safeOptions: { owners: list, threshold, saltNonce: saltNonce ?? deterministicSalt(list, threshold) }
  }
}

// the module's own default when no salt is given, made explicit so the stored Safe is complete
export const deterministicSalt = (owners, threshold) => WalletAccountReadOnlyMultisigEvmSafe4337.generateDeterministicSaltNonce(owners, threshold)

// counterfactual address, no chain access: the module hashes owners, threshold and salt
export async function predictSafeAddress (net, options) {
  const account = new WalletAccountReadOnlyMultisigEvmSafe4337(safeConfigOf(net, options, new LocalCoordinator()))
  return account.getAddress()
}
