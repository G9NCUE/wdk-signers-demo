// Exercises every remote signer through the real WalletManagerEvm, over HTTP, like the browser does.
// Nothing is broadcast. Run with the service up: node server/probe.js [turnkey|dfns|...]
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { Transaction, verifyAuthorization, verifyMessage, verifyTypedData } from 'ethers'
import RemoteSignerEvm from '../src/signers/remote-signer-evm.js'

const base = process.env.SIGNER_SERVICE_URL || 'http://127.0.0.1:8787/api'
const only = process.argv[2]
const list = await (await fetch(`${base}/signers`)).json()

for (const s of list) {
  if (only && s.id !== only) continue
  if (!s.available) { console.log(`${s.id.padEnd(10)} skipped: ${s.reason}`); continue }
  const signer = new RemoteSignerEvm({ id: s.id, path: s.path, isDerivable: s.isDerivable, baseUrl: base })
  const wallet = s.isDerivable ? new WalletManagerEvm(signer) : named(signer)
  const account = await (s.isDerivable ? wallet.getAccount(0) : wallet.getAccount('remote'))
  const address = await account.getAddress()
  const t0 = Date.now()
  // one failing operation must not hide the others, a provider can refuse one kind of payload
  const check = async (name, fn) => {
    try { console.log(`${s.id.padEnd(10)} ${name.padEnd(18)} ${await fn() ? 'ok' : 'FAIL'}`) } catch (e) { console.log(`${s.id.padEnd(10)} ${name.padEnd(18)} error: ${e.message}`) }
  }

  console.log(`${s.id.padEnd(10)} address            ${address} ${account.path ?? ''}`)
  await check('sign', async () => verifyMessage('hello', await account.sign('hello')) === address)
  await check('signTransaction', async () => Transaction.from(await account.signTransaction({ chainId: 11155111, nonce: 0, to: address, value: 0n, data: '0x', type: 2, gasLimit: 21000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })).from === address)
  const typed = { domain: { name: 'WDK', version: '1', chainId: 11155111, verifyingContract: address }, types: { Transfer: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] }, message: { to: address, amount: 42 } }
  await check('signTypedData', async () => verifyTypedData(typed.domain, typed.types, typed.message, await account.signTypedData(typed)) === address)
  await check('signAuthorization', async () => { const auth = await account.signAuthorization({ address, nonce: 1, chainId: 11155111 }); return verifyAuthorization(auth, auth.signature) === address })
  if (s.isDerivable) {
    const a1 = await wallet.getAccount(1)
    console.log(`${s.id.padEnd(10)} account 1          ${await a1.getAddress()} ${a1.path}`)
  }
  console.log(`${s.id.padEnd(10)} ${Date.now() - t0} ms`)
  wallet.dispose()
}

function named (signer) {
  const wallet = new WalletManagerEvm('test test test test test test test test test test test junk')
  wallet.addSigner('remote', signer)
  return wallet
}
