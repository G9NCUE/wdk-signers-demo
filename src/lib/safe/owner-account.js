// A Safe owner account on any WalletAccountEvm, hence on any ISigner.
// wdk-protocol-multisig-safe's account takes (seed, path, config) and builds its owner from the seed,
// although it only reads getAddress, signTypedData, keyPair, index, path and, to deploy, sendTransaction
// on it. This shim builds it on a throwaway seed and swaps the owner for the account given. It goes
// away the day the module accepts an account, as wdk-wallet-evm-7702-gasless does.
import { WalletAccountMultisigEvmSafe4337 } from '@tetherto/wdk-protocol-multisig-safe'
import { THROWAWAY_SEED } from '../wallet.js'

export default class SafeOwnerAccount extends WalletAccountMultisigEvmSafe4337 {
  constructor (account, config) {
    super(THROWAWAY_SEED, "0'/0/0", config)
    // the swap rests on a private field; a module that renamed it would sign with the throwaway seed
    if (!this._signerAccount) throw new Error('wdk-protocol-multisig-safe no longer keeps its owner in _signerAccount; the owner shim cannot swap it')
    this._signerAccount.dispose() // the seed-built owner is never used
    this._signerAccount = account
  }

  // the account was given to us and stays with its wallet; the module skips a null owner
  dispose () {
    this._signerAccount = null
    super.dispose()
  }
}
