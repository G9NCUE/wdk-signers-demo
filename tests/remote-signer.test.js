// The browser's RemoteSignerEvm against the service, in-process, on the WDK's own signers as the
// "remote" providers: proves the HTTP protocol carries the whole ISignerEvm contract, derivable or not.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { HDNodeWallet, Transaction, verifyAuthorization, verifyMessage, verifyTypedData } from 'ethers'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { PrivateKeySignerEvm, SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import RemoteSignerEvm from '../src/signers/remote-signer-evm.js'
import { registryOf, startService } from './helpers/service.js'

// throwaway test mnemonics, never funded
const MNEMONIC = 'test test test test test test test test test test test junk'
const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const single = HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/9")

let service, logged
before(async () => {
  logged = []
  service = await startService(registryOf([
    { id: 'hd', label: 'HD', kind: 'derivable', root: new SeedSignerEvm(MNEMONIC) },
    { id: 'single', label: 'Single', kind: 'one key', root: new PrivateKeySignerEvm(single.privateKey) },
    { id: 'down', label: 'Down', kind: 'unconfigured', root: null, available: false, reason: 'missing X_KEY' }
  ]), { log: m => logged.push(m) })
})
after(() => service.close())

const list = async () => (await fetch(`${service.baseUrl}/signers`)).json()
const remote = (s) => new RemoteSignerEvm({ id: s.id, path: s.path, isDerivable: s.isDerivable, baseUrl: service.baseUrl })
const expected = (i) => HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).address

test('the service lists signers with availability, derivability and path', async () => {
  const signers = await list()
  assert.deepEqual(signers.map(s => [s.id, s.available, s.isDerivable]), [['hd', true, true], ['single', true, false], ['down', false, null]])
  assert.equal(signers[2].reason, 'missing X_KEY')
  assert.match(signers[0].path, /44'\/60'\/0'\/0\/0$/)
})

test('a derivable remote signer drives WalletManagerEvm: three accounts, addresses, public keys', async () => {
  const [hd] = await list()
  const wallet = new WalletManagerEvm(remote(hd))
  for (const i of [0, 1, 2]) {
    const account = await wallet.getAccount(i)
    assert.equal(await account.getAddress(), expected(i))
    assert.equal(account.keyPair.privateKey, null)
    assert.equal(account.keyPair.publicKey.length, 33)
  }
  wallet.dispose()
})

test('the four signatures come back over HTTP and recover to the account', async () => {
  const [hd] = await list()
  const wallet = new WalletManagerEvm(remote(hd))
  const account = await wallet.getAccount(1)
  const address = await account.getAddress()

  assert.equal(verifyMessage('over http', await account.sign('over http')), address)

  const signed = await account.signTransaction({ chainId: 11155111, nonce: 3, to: address, value: 1n, data: '0x', type: 2, gasLimit: 21000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })
  const tx = Transaction.from(signed)
  assert.equal(tx.from, address)
  assert.equal(tx.nonce, 3)
  assert.equal(tx.value, 1n)

  const typed = { domain: { name: 'WDK', version: '1', chainId: 11155111, verifyingContract: address }, types: { Transfer: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] }, message: { to: address, amount: 42 } }
  assert.equal(verifyTypedData(typed.domain, typed.types, typed.message, await account.signTypedData(typed)), address)

  const auth = await account.signAuthorization({ address, nonce: 1, chainId: 11155111 })
  assert.equal(verifyAuthorization(auth, auth.signature), address)
  assert.equal(typeof auth.chainId, 'bigint')
  wallet.dispose()
})

test('a single-key remote signer is registered by name and refuses to derive', async () => {
  const [, s] = await list()
  const signer = remote(s)
  assert.throws(() => new WalletManagerEvm(signer), /derivable/)
  const wallet = new WalletManagerEvm(SEED)
  wallet.addSigner('remote', signer)
  const account = await wallet.getAccount('remote')
  assert.equal(await account.getAddress(), single.address)
  assert.equal(verifyMessage('one key', await account.sign('one key')), single.address)
  await assert.rejects(signer.derive("0'/0/1"), /derived child|Cannot derive/)
  wallet.dispose()
})

test('an unavailable provider answers 503 with its reason, a wrong id 404', async () => {
  const [, , down] = await list()
  await assert.rejects(remote(down).getAddress(), /down: missing X_KEY/)
  await assert.rejects(new RemoteSignerEvm({ id: 'nope', path: null, isDerivable: false, baseUrl: service.baseUrl }).getAddress(), /unknown signer/)
})

test('a provider error surfaces with the provider name and is logged by the service', async () => {
  const [hd] = await list()
  const signer = remote(hd)
  const child = await signer.derive("0'/0/0")
  // "from" that does not match the account is refused by the WDK signer itself
  await assert.rejects(child.signTransaction({ from: '0x0000000000000000000000000000000000000001', chainId: 1, nonce: 0 }), /hd: /)
  assert.ok(logged.some(m => m.startsWith('[hd] signTransaction')))
})

test('a disposed remote signer stops calling the service', async () => {
  const [hd] = await list()
  const signer = remote(hd)
  signer.dispose()
  await assert.rejects(signer.getAddress(), /disposed/)
})
