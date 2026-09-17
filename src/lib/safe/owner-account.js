// A Safe owner account on any WalletAccountEvm, hence on any ISigner.
// wdk-protocol-multisig-safe's account takes (seed, path, config) and builds its owner from the seed,
// although it only calls getAddress, signTypedData and, for deploy(), sendTransaction on it. This shim
// builds it on a throwaway seed and swaps the owner for the account given. It goes away the day the
// module accepts an account, as wdk-wallet-evm-7702-gasless does.
import { WalletAccountMultisigEvmSafe4337 } from '@tetherto/wdk-protocol-multisig-safe'

const THROWAWAY_SEED = 'test test test test test test test test test test test junk'

export default class SafeOwnerAccount extends WalletAccountMultisigEvmSafe4337 {
  constructor (account, config) {
    super(THROWAWAY_SEED, "0'/0/0", config)
    this._signerAccount.dispose() // the seed-built owner is never used
    this._signerAccount = account
    this._ownsSigner = false
  }

  // the account was given to us, its owner disposes it
  dispose () {
    const account = this._signerAccount
    this._signerAccount = null
    super.dispose()
    this._signerAccount = null
    void account
  }
}
